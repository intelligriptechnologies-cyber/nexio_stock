"""products: pending_origin + pending_added_by_user_id (issue #31)

Revision ID: 535c5717cfea
Revises: b67d5dd3b807
Create Date: 2026-07-08 00:00:00.000000

Issue #31 — the Pending Products list (#25) used to re-derive origin
(receiving vs checkout) and the adding user by scanning every
``product.pending_created`` row across ``stockin_logs`` and
``invoicing_logs`` on every list call. That data is already known once,
at quick-add write time, via the ``X-Quick-Add-Origin`` header — this
records it directly on the ``Product`` row instead.

Both columns are nullable: existing pending products (created before
this migration) have no recorded origin/actor, and products created via
the regular POST/CSV-import paths are never quick-added, so they're
NULL by design, not backfill gaps.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "535c5717cfea"
down_revision: Union[str, None] = "b67d5dd3b807"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("pending_origin", sa.String(length=16), nullable=True))
    op.add_column(
        "products", sa.Column("pending_added_by_user_id", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_products_pending_added_by_user_id_users",
        "products",
        "users",
        ["pending_added_by_user_id"],
        ["id"],
        ondelete="set null",
    )

    # One-time backfill from the log tables this column replaces as the
    # read path's source of truth. This is the last moment that join is
    # convenient to write, so recover what we can for rows already
    # pending; anything with no matching log entry (predates the #22
    # audit-log write, or was inserted outside the API) is left NULL --
    # an accurate "unknown", not a data-loss gap.
    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE products p
            SET pending_origin = 'receiving',
                pending_added_by_user_id = s.actor_user_id
            FROM stockin_logs s
            WHERE p.status = 'pending'
              AND s.event_type = 'product.pending_created'
              AND (s.payload->>'product_id')::int = p.id
            """
        )
    )
    conn.execute(
        sa.text(
            """
            UPDATE products p
            SET pending_origin = 'checkout',
                pending_added_by_user_id = i.actor_user_id
            FROM invoicing_logs i
            WHERE p.status = 'pending'
              AND p.pending_origin IS NULL
              AND i.event_type = 'product.pending_created'
              AND (i.payload->>'product_id')::int = p.id
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_products_pending_added_by_user_id_users", "products", type_="foreignkey"
    )
    op.drop_column("products", "pending_added_by_user_id")
    op.drop_column("products", "pending_origin")
