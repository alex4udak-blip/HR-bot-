from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..config import get_settings
from ..database import get_db
from ..models.database import User, UserRole

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


def hash_password(password: str) -> str:
    # bcrypt has a 72 byte limit for passwords
    truncated = password[:72] if len(password.encode('utf-8')) > 72 else password
    return pwd_context.hash(truncated)


def verify_password(plain: str, hashed: str) -> bool:
    # bcrypt has a 72 byte limit for passwords
    truncated = plain[:72] if len(plain.encode('utf-8')) > 72 else plain
    return pwd_context.verify(truncated, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expire_minutes)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(
            credentials.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


async def get_superadmin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.SUPERADMIN:
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.password_hash):
        return user
    return None


async def create_superadmin_if_not_exists(db: AsyncSession):
    result = await db.execute(select(User).where(User.role == UserRole.SUPERADMIN))
    if not result.scalar_one_or_none():
        superadmin = User(
            email=settings.superadmin_email,
            password_hash=hash_password(settings.superadmin_password),
            name="Super Admin",
            role=UserRole.SUPERADMIN,
        )
        db.add(superadmin)
        await db.commit()
        print(f"Superadmin created: {settings.superadmin_email}")
