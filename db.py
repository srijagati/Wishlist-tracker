"""
db.py
Handles all database setup and interactions for the Wishlist Tracker app.
Uses SQLite - no separate database server needed, it's just a file (wishlist.db).
"""

import sqlite3

DB_NAME = "wishlist.db"


def get_connection():
    """Opens a connection to the database file."""
    return sqlite3.connect(DB_NAME)


def init_db():
    """
    Creates the tables if they don't already exist.
    Safe to run every time the app starts - it won't wipe existing data.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Stores table - just a name and URL for now
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT
        )
    """)

    # Items table - each item belongs to a store (store_id links to stores.id)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            product_url TEXT NOT NULL,
            current_price REAL,
            target_price REAL,
            date_added TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (store_id) REFERENCES stores (id)
        )
    """)

    # Price history table - every time we check a price, we log it here
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            price REAL NOT NULL,
            checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES items (id)
        )
    """)

    conn.commit()
    conn.close()


# ---------- STORE FUNCTIONS ----------

def add_store(name, url=""):
    """Adds a new store and returns its id."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO stores (name, url) VALUES (?, ?)", (name, url))
    conn.commit()
    store_id = cursor.lastrowid
    conn.close()
    return store_id


def get_stores():
    """Returns a list of all stores as (id, name, url) tuples."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, url FROM stores")
    rows = cursor.fetchall()
    conn.close()
    return rows


# ---------- ITEM FUNCTIONS ----------

def add_item(store_id, name, product_url, current_price=None, target_price=None):
    """Adds a new item under a given store and returns its id."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO items (store_id, name, product_url, current_price, target_price)
        VALUES (?, ?, ?, ?, ?)
    """, (store_id, name, product_url, current_price, target_price))
    conn.commit()
    item_id = cursor.lastrowid
    conn.close()
    return item_id


def get_items(store_id=None):
    """
    Returns items as a list of tuples.
    If store_id is given, only returns items for that store.
    Otherwise returns everything.
    """
    conn = get_connection()
    cursor = conn.cursor()
    if store_id:
        cursor.execute("""
            SELECT id, store_id, name, product_url, current_price, target_price, date_added
            FROM items WHERE store_id = ?
        """, (store_id,))
    else:
        cursor.execute("""
            SELECT id, store_id, name, product_url, current_price, target_price, date_added
            FROM items
        """)
    rows = cursor.fetchall()
    conn.close()
    return rows


def update_price(item_id, new_price):
    """
    Updates an item's current price AND logs the price into price_history.
    This is the function scraper.py will call after checking a site.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("UPDATE items SET current_price = ? WHERE id = ?", (new_price, item_id))
    cursor.execute("INSERT INTO price_history (item_id, price) VALUES (?, ?)", (item_id, new_price))

    conn.commit()
    conn.close()


def get_price_history(item_id):
    """Returns all logged prices for an item, oldest first."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT price, checked_at FROM price_history
        WHERE item_id = ? ORDER BY checked_at ASC
    """, (item_id,))
    rows = cursor.fetchall()
    conn.close()
    return rows


# ---------- QUICK TEST ----------
# This only runs if you execute "python db.py" directly (not when imported).
# It's a simple way to confirm everything works before building the UI.
if __name__ == "__main__":
    init_db()
    print("Database initialized.")

    # Add a test store
    store_id = add_store("Nike", "https://www.nike.com")
    print(f"Added store with id {store_id}")

    # Add a test item under that store
    item_id = add_item(store_id, "Air Max 90", "https://www.nike.com/some-shoe", current_price=120.00, target_price=90.00)
    print(f"Added item with id {item_id}")

    # Simulate a price check finding a lower price
    update_price(item_id, 105.00)
    print("Updated price to 105.00")

    # Print everything back out
    print("\nStores:", get_stores())
    print("Items:", get_items())
    print("Price history:", get_price_history(item_id))