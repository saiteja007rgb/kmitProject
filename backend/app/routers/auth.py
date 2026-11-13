from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.models import User, Candidate
from app.schemas import LoginRequest, TokenResponse, UserProfile
from app.utils.security import verify_password, create_access_token
from app.routers.deps import get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

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
