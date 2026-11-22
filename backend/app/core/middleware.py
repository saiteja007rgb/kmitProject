"""Pure-ASGI middleware (cheaper than BaseHTTPMiddleware): security headers and request size cap."""
from app.config import settings

API_SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(self), microphone=(), geolocation=()"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"cache-control", b"no-store"),  # API responses contain personal data
]


class SecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        declared_length = dict(scope["headers"]).get(b"content-length", b"0")
        if declared_length.isdigit() and int(declared_length) > settings.max_request_bytes:
            return await _send_plain_response(send, 413, b"Request body too large")

        is_api_path = scope["path"].startswith("/api")

        async def send_with_headers(message):
            if message["type"] == "http.response.start" and is_api_path:
                message["headers"] = list(message.get("headers", [])) + API_SECURITY_HEADERS
            await send(message)

        await self.app(scope, receive, send_with_headers)


async def _send_plain_response(send, status_code: int, body: bytes) -> None:
    await send({"type": "http.response.start", "status": status_code, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": body})

