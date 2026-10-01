//! Identity `#[command]` — passes the item through unchanged (the
//! mirror's compile-check contract; see the crate docs).

#[proc_macro_attribute]
pub fn command(_attr: proc_macro::TokenStream, item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    item
}
