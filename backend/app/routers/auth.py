from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User, Candidate
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserProfile
from app.utils.security import verify_password, create_access_token, hash_password
from app.routers.deps import get_current_user
from app.config import settings
from app.redis_client import redis_manager

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

@router.post("/register", response_model=TokenResponse)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # 1. Validate username uniqueness
    stmt = select(User).where(User.username == req.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken. Please choose another."
        )

    # 2. Validate role & permissions
    requested_role = req.role.lower().strip()
    if requested_role in ["admin", "invigilator"]:
        valid_secret = getattr(settings, "ADMIN_SECRET", "admin123")
        if req.admin_secret != valid_secret and req.admin_secret != settings.JWT_SECRET:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid Staff/Administrator authorization key."
            )
        assigned_role = requested_role
    else:
        assigned_role = "candidate"

    # 3. Create User record with Bcrypt hash
    pw_hash = hash_password(req.password)
    new_user = User(
        username=req.username,
        password_hash=pw_hash,
        role=assigned_role
    )
    db.add(new_user)
    await db.flush()

    candidate_id = None
    display_name = req.display_name.strip() or req.username

    # 4. If candidate, create Candidate profile
    if assigned_role == "candidate":
        cand_code = req.candidate_code.strip() if req.candidate_code else f"C-{new_user.id[:6].upper()}"
        code_check = await db.execute(select(Candidate).where(Candidate.candidate_code == cand_code))
        if code_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Candidate code '{cand_code}' is already registered."
            )

        new_cand = Candidate(
            user_id=new_user.id,
            candidate_code=cand_code,
            display_name=display_name
        )
        db.add(new_cand)
        await db.flush()
        candidate_id = new_cand.id

    await db.commit()
    await db.refresh(new_user)

    # 5. Issue JWT token
    token = create_access_token({
        "sub": new_user.id,
        "username": new_user.username,
        "role": new_user.role,
        "candidate_id": candidate_id
    })

    if assigned_role == "candidate":
        new_user.active_token = token
        await db.commit()
        await redis_manager.set_raw(f"active_token:{new_user.id}", token)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        role=new_user.role,
        user_id=new_user.id,
        candidate_id=candidate_id,
        display_name=display_name
    )

@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.username == req.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )

    candidate_id = None
    display_name = user.username
    if user.role == "candidate":
        cand_result = await db.execute(select(Candidate).where(Candidate.user_id == user.id))
        candidate = cand_result.scalar_one_or_none()
        if candidate:
            candidate_id = candidate.id
            display_name = candidate.display_name

    token = create_access_token({
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "candidate_id": candidate_id
    })

    if user.role == "candidate":
        user.active_token = token
        await db.commit()
        await redis_manager.set_raw(f"active_token:{user.id}", token)

    return TokenResponse(
        access_token=token,
        token_type="bearer",
        role=user.role,
        user_id=user.id,
        candidate_id=candidate_id,
        display_name=display_name
    )

@router.get("/me", response_model=UserProfile)
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    candidate_id = None
    display_name = user.username
    if user.role == "candidate":
        cand_result = await db.execute(select(Candidate).where(Candidate.user_id == user.id))
        candidate = cand_result.scalar_one_or_none()
        if candidate:
            candidate_id = candidate.id
            display_name = candidate.display_name

    return UserProfile(
        id=user.id,
        username=user.username,
        role=user.role,
        candidate_id=candidate_id,
        display_name=display_name
    )
