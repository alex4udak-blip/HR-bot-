from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from .models.database import Base
from .utils.db_url import get_database_url


database_url = get_database_url()

engine = create_async_engine(database_url, echo=False, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
