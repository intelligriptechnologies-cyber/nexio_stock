"""users: global phone uniqueness + superadmin username uniqueness

Login for shop-scoped roles (owner/receiver_user/cashier_user) looks a user
up by phone alone, without knowing which shop they belong to (D-13/D-58).
The old UNIQUE(shop_id, phone) constraint only guaranteed uniqueness within
one shop, so once a second shop existed, two owners in different shops
could share a phone number — the login lookup would then match two rows
and crash with MultipleResultsFound instead of returning a token.

Same issue for superadmin: UNIQUE(shop_id, username) is a no-op for
superadmin rows since shop_id is NULL for all of them (NULL <> NULL for
uniqueness purposes), so two superadmin accounts could share a username.

Revision ID: f66dd42ad7e7
Revises: af4b5e908f57
Create Date: 2026-07-07 06:00:00.000000

"""
from typing import Union
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f66dd42ad7e7'
down_revision: str | Sequence[str] | None = 'af4b5e908f57'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("uq_users_shop_phone", "users", type_="unique")
    op.create_unique_constraint("uq_users_phone", "users", ["phone"])
    op.create_index(
        "uq_users_username_superadmin",
        "users",
        ["username"],
        unique=True,
        postgresql_where=sa.text("shop_id IS NULL"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("uq_users_username_superadmin", table_name="users")
    op.drop_constraint("uq_users_phone", "users", type_="unique")
    op.create_unique_constraint("uq_users_shop_phone", "users", ["shop_id", "phone"])
