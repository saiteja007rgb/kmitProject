"""Sandboxed multi-language code execution using Linux bubblewrap (bwrap).

Each compilation and test execution runs inside an unprivileged Linux namespace with:
- no network access (`--unshare-net`), isolated PID/IPC/UTS namespaces (`--unshare-all`)
- read-only host OS libraries and a private writable `/work` directory + `/tmp`
- hard CPU, file-size, memory, output-size, and wall-clock limits
- automatic termination if the parent process exits (`--die-with-parent`)
"""
import asyncio
import logging
import os
import shutil
import signal
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from app.schemas.attempts import CodeRunResult, CodeTestCaseResult
from app.schemas.exams import CodingLanguage, CodingTestCase

logger = logging.getLogger("exampulse.sandbox")

MAX_CONCURRENT_RUNS = 4
MAX_OUTPUT_BYTES = 65_536
COMPILE_TIMEOUT_SECONDS = 12.0
_execution_semaphore = asyncio.Semaphore(MAX_CONCURRENT_RUNS)


@dataclass(frozen=True)
class _ProcessOutcome:
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    elapsed_ms: int


def _normalize_output(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def _find_binary(name: str) -> str | None:
    resolved = shutil.which(name)
    return str(Path(resolved).resolve()) if resolved else None


def _build_sandbox_command(work_dir: Path, inner_argv: list[str], extra_ro_dirs: list[Path] | None = None) -> list[str]:
    """Wraps `inner_argv` in bubblewrap when available, with minimal read-only mounts."""
    bwrap_bin = shutil.which("bwrap")
    if not bwrap_bin:
        return inner_argv

    path_entries = ["/usr/bin", "/bin"]
    cmd = [
        bwrap_bin,
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--ro-bind", "/usr", "/usr",
        "--symlink", "usr/bin", "/bin",
        "--symlink", "usr/lib", "/lib",
        "--symlink", "usr/lib", "/lib64",
        "--ro-bind", "/etc", "/etc",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--bind", str(work_dir), "/work",
        "--chdir", "/work",
        "--clearenv",
        "--setenv", "HOME", "/tmp",
        "--setenv", "TMPDIR", "/tmp",
        "--setenv", "LANG", "C.UTF-8",
    ]

    seen_mounts: set[Path] = set()
    for directory in extra_ro_dirs or []:
        resolved = directory.resolve()
        if resolved in seen_mounts or str(resolved).startswith("/usr"):
            continue
        seen_mounts.add(resolved)
        mount_target = str(resolved)
        cmd.extend(["--ro-bind", mount_target, mount_target])
        bin_dir = resolved / "bin"
        path_entries.insert(0, str(bin_dir if bin_dir.is_dir() else resolved))

    cmd.extend(["--setenv", "PATH", ":".join(path_entries)])
    cmd.extend(inner_argv)
    return cmd


async def _read_capped(stream: asyncio.StreamReader | None, max_bytes: int) -> bytes:
    if stream is None:
        return b""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await stream.read(4096)
        if not chunk:
            break
        remaining = max_bytes - total
        if remaining > 0:
            chunks.append(chunk[:remaining])
            total += min(len(chunk), remaining)
    return b"".join(chunks)


async def _run_process(
    argv: list[str],
    *,
    cwd: Path,
    stdin_text: str = "",
    timeout_seconds: float,
) -> _ProcessOutcome:
    started = time.monotonic()
    process = await asyncio.create_subprocess_exec(
        *argv,
        cwd=str(cwd),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # lets us kill the entire process group on timeout
    )

    timed_out = False
    stdout_task = asyncio.create_task(_read_capped(process.stdout, MAX_OUTPUT_BYTES))
    stderr_task = asyncio.create_task(_read_capped(process.stderr, MAX_OUTPUT_BYTES))

    try:
        if process.stdin is not None:
            process.stdin.write(stdin_text.encode("utf-8", errors="replace"))
            await process.stdin.drain()
            process.stdin.close()
    except (BrokenPipeError, ConnectionResetError):
        pass

    try:
        await asyncio.wait_for(process.wait(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()

    stdout_bytes, stderr_bytes = await asyncio.gather(stdout_task, stderr_task)
    elapsed_ms = int((time.monotonic() - started) * 1000)

    return _ProcessOutcome(
        exit_code=process.returncode if process.returncode is not None else -1,
        stdout=stdout_bytes.decode("utf-8", errors="replace"),
        stderr=stderr_bytes.decode("utf-8", errors="replace"),
        timed_out=timed_out,
        elapsed_ms=elapsed_ms,
    )


def _extra_mounts_for_binary(binary_path: str | None) -> list[Path]:
    if not binary_path:
        return []
    path = Path(binary_path)
    # Mount the runtime's prefix (e.g. ~/.local/share/nodejs/node-v26.../) when outside /usr.
    if str(path).startswith("/usr/"):
        return []
    return [path.parent.parent if path.parent.name == "bin" else path.parent]


def _shell_limited(inner_command: str, *, cpu_seconds: int, memory_mb: int | None) -> list[str]:
    limits = [f"ulimit -t {cpu_seconds}", "ulimit -f 32768"]
    if memory_mb is not None:
        # Virtual address space cap works reliably for C/C++/Python; JVM/V8 use runtime heap flags instead.
        limits.append(f"ulimit -v {memory_mb * 1024}")
    return ["/bin/sh", "-c", f"{' && '.join(limits)} && exec {inner_command}"]


async def _prepare_language(
    language: CodingLanguage,
    code: str,
    work_dir: Path,
    memory_limit_mb: int,
) -> tuple[list[str] | None, list[Path], str | None]:
    """Writes source file, compiles if needed, and returns (run_argv, extra_mounts, compile_error)."""
    if language == "python":
        (work_dir / "solution.py").write_text(code, encoding="utf-8")
        python_bin = _find_binary("python3")
        if not python_bin:
            return None, [], "Python runtime is not installed on this server."
        mounts = _extra_mounts_for_binary(python_bin)
        return [python_bin, "-I", "/work/solution.py"], mounts, None

    if language == "javascript":
        (work_dir / "solution.js").write_text(code, encoding="utf-8")
        node_bin = _find_binary("node")
        if not node_bin:
            return None, [], "Node.js runtime is not installed on this server."
        mounts = _extra_mounts_for_binary(node_bin)
        return [node_bin, f"--max-old-space-size={memory_limit_mb}", "/work/solution.js"], mounts, None

    if language == "c":
        (work_dir / "solution.c").write_text(code, encoding="utf-8")
        gcc_bin = _find_binary("gcc")
        if not gcc_bin:
            return None, [], "GCC compiler is not installed on this server."
        compile_cmd = _build_sandbox_command(
            work_dir, [gcc_bin, "-O2", "-std=c17", "/work/solution.c", "-o", "/work/solution", "-lm"]
        )
        outcome = await _run_process(compile_cmd, cwd=work_dir, timeout_seconds=COMPILE_TIMEOUT_SECONDS)
        if outcome.timed_out or outcome.exit_code != 0:
            return None, [], (outcome.stderr or outcome.stdout or "Compilation timed out.").strip()
        return ["/work/solution"], [], None

    if language == "cpp":
        (work_dir / "solution.cpp").write_text(code, encoding="utf-8")
        gpp_bin = _find_binary("g++")
        if not gpp_bin:
            return None, [], "G++ compiler is not installed on this server."
        compile_cmd = _build_sandbox_command(
            work_dir, [gpp_bin, "-O2", "-std=c++17", "/work/solution.cpp", "-o", "/work/solution"]
        )
        outcome = await _run_process(compile_cmd, cwd=work_dir, timeout_seconds=COMPILE_TIMEOUT_SECONDS)
        if outcome.timed_out or outcome.exit_code != 0:
            return None, [], (outcome.stderr or outcome.stdout or "Compilation timed out.").strip()
        return ["/work/solution"], [], None

    if language == "java":
        (work_dir / "Main.java").write_text(code, encoding="utf-8")
        javac_bin = _find_binary("javac")
        java_bin = _find_binary("java")
        if not javac_bin or not java_bin:
            return None, [], "OpenJDK (javac/java) is not installed on this server."
        compile_cmd = _build_sandbox_command(
            work_dir, [javac_bin, "-J-Xmx256m", "/work/Main.java"], _extra_mounts_for_binary(javac_bin)
        )
        outcome = await _run_process(compile_cmd, cwd=work_dir, timeout_seconds=COMPILE_TIMEOUT_SECONDS)
        if outcome.timed_out or outcome.exit_code != 0:
            return None, [], (outcome.stderr or outcome.stdout or "Compilation timed out.").strip()
        return [java_bin, f"-Xmx{memory_limit_mb}m", "-XX:+UseSerialGC", "-cp", "/work", "Main"], _extra_mounts_for_binary(java_bin), None

    return None, [], f"Unsupported language: {language}"


def _classify_verdict(outcome: _ProcessOutcome, expected_output: str | None) -> tuple[str, str]:
    if outcome.timed_out:
        return "time_limit", outcome.stderr.strip() or "Execution exceeded the time limit."

    combined_stderr = outcome.stderr.strip()
    if outcome.exit_code != 0:
        # Exit codes 137 (SIGKILL) / MemoryError / OutOfMemoryError indicate memory exhaustion.
        lowered = combined_stderr.lower()
        if outcome.exit_code in (137, -9) or "memoryerror" in lowered or "outofmemoryerror" in lowered or "bad_alloc" in lowered:
            return "memory_limit", combined_stderr or "Memory limit exceeded."
        if outcome.exit_code in (152, -24):  # SIGXCPU from ulimit -t
            return "time_limit", "CPU time limit exceeded."
        return "runtime_error", combined_stderr or outcome.stdout.strip() or f"Exited with status {outcome.exit_code}."

    if expected_output is None:
        return "custom", outcome.stdout

    if _normalize_output(outcome.stdout) == _normalize_output(expected_output):
        return "passed", outcome.stdout
    return "wrong_answer", outcome.stdout


async def execute_code(
    *,
    language: CodingLanguage,
    code: str,
    test_cases: list[CodingTestCase] | None = None,
    custom_input: str | None = None,
    time_limit_ms: int = 2000,
    memory_limit_mb: int = 256,
) -> CodeRunResult:
    """Compiles (if needed) and runs `code` against either `custom_input` or `test_cases`."""
    async with _execution_semaphore:
        with tempfile.TemporaryDirectory(prefix="exampulse_run_") as tmp_path:
            work_dir = Path(tmp_path)
            os.chmod(work_dir, 0o755)

            run_argv, extra_mounts, compile_error = await _prepare_language(language, code, work_dir, memory_limit_mb)
            if compile_error is not None or run_argv is None:
                return CodeRunResult(status="compile_error", compile_output=compile_error, results=[])

            cpu_seconds = max(1, (time_limit_ms + 999) // 1000 + 1)
            # Java & Node reserve large virtual address spaces; enforce memory via JVM/V8 flags rather than RLIMIT_AS.
            vmem_limit = None if language in ("java", "javascript") else max(memory_limit_mb, 128)
            quoted_cmd = " ".join(f"'{arg}'" for arg in run_argv)
            limited_argv = _shell_limited(quoted_cmd, cpu_seconds=cpu_seconds, memory_mb=vmem_limit)
            sandboxed_argv = _build_sandbox_command(work_dir, limited_argv, extra_mounts)

            # Give JVM/Node a slightly higher wall-clock startup cushion while keeping CPU time capped.
            wall_timeout = (time_limit_ms / 1000.0) + (2.5 if language == "java" else 1.0)

            cases_to_run: list[tuple[str, str | None]] = (
                [(custom_input, None)]
                if custom_input is not None
                else [(case.input, case.expected_output) for case in (test_cases or [])]
            )

            results: list[CodeTestCaseResult] = []
            for test_input, expected in cases_to_run:
                outcome = await _run_process(sandboxed_argv, cwd=work_dir, stdin_text=test_input, timeout_seconds=wall_timeout)
                verdict, actual = _classify_verdict(outcome, expected)
                results.append(
                    CodeTestCaseResult(
                        input=test_input,
                        expected_output=expected,
                        actual_output=actual,
                        verdict=verdict,
                        time_ms=outcome.elapsed_ms,
                    )
                )

            return CodeRunResult(status="ok", compile_output=None, results=results)
