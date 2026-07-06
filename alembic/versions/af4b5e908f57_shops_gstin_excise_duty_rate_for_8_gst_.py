"""shops: gstin + excise_duty_rate for #8 GST/excise line

Revision ID: af4b5e908f57
Revises: c514c436a0b1
Create Date: 2026-07-07 02:52:14.513120

"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'af4b5e908f57'
down_revision: str | Sequence[str] | None = 'c514c436a0b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "shops", sa.Column("gstin", sa.String(length=15), nullable=True)
    )
    op.add_column(
        "shops",
        sa.Column("excise_duty_rate", sa.Numeric(precision=8, scale=2), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("shops", "excise_duty_rate")
    op.drop_column("shops", "gstin")
