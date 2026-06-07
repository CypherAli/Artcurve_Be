pub mod order;
pub mod matcher;

use std::collections::HashMap;
use tokio::sync::RwLock;
use uuid::Uuid;

use matcher::{ArtworkBookV2, CurveSnapshot};
use order::{IncomingOrder, MatchResult, Order, OrderRejected};

/// Registry of all artwork order books.
/// Wrapped in RwLock for safe concurrent access.
pub struct BookRegistry {
    books: RwLock<HashMap<Uuid, ArtworkBookV2>>,
}

impl BookRegistry {
    pub fn new() -> Self {
        BookRegistry {
            books: RwLock::new(HashMap::new()),
        }
    }

    /// Ensure an artwork book exists; create with defaults if not
    pub async fn ensure_book(&self, artwork_id: Uuid, snapshot: CurveSnapshot, supply: rust_decimal::Decimal) {
        let mut books = self.books.write().await;
        books.entry(artwork_id).or_insert_with(|| {
            ArtworkBookV2::new(artwork_id, supply, snapshot)
        });
    }

    /// Process an incoming order through its artwork book
    pub async fn process_order(
        &self,
        incoming: IncomingOrder,
        snapshot: CurveSnapshot,
    ) -> Result<MatchResult, OrderRejected> {
        let artwork_id = incoming.artwork_id;

        {
            let read = self.books.read().await;
            if !read.contains_key(&artwork_id) {
                drop(read);
                let mut write = self.books.write().await;
                write.entry(artwork_id).or_insert_with(|| {
                    // Default supply = 0 if no snapshot provided yet
                    ArtworkBookV2::new(artwork_id, rust_decimal::Decimal::ZERO, snapshot.clone())
                });
            }
        }

        let mut books = self.books.write().await;
        let book = books.get_mut(&artwork_id).unwrap();
        let order = Order::from_incoming(incoming);
        book.process(order)
    }
}
