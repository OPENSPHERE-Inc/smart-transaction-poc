use wasm_bindgen::prelude::*;

const CURRENCY_MOSAIC_ID: &str = "72C0212E67A08BCE";
const SALE_MOSAIC_ID: &str = "4A6D2C0931B10E39";
const SELLER_PUBLIC_KEY: &str = "9208AC67CE76277831C7E5A14A4CC06D1742A79EF4172885B38A6048C5944E40";
const PRICE: f64 = 100000000.0;

#[wasm_bindgen]
extern {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn debug(s: &str);
}

#[wasm_bindgen]
extern {
    // Many Symbol libs should be provided.
    #[wasm_bindgen(js_namespace = symbolLibrary)]
    async fn getAccountBalance(account: &str, mosaic_id: &str) -> JsValue;
    #[wasm_bindgen(js_namespace = symbolLibrary)]
    async fn transferMosaic(from: &str, to: &str, mosaic_id: &str, amount: f64, message: &str);
}

#[wasm_bindgen]
pub async fn exchange(buyer: &str, amount: f64) -> bool {
    if amount <= 0.0 || buyer == "" {
        return false;
    }

    let balance = getAccountBalance(buyer, CURRENCY_MOSAIC_ID).await;
    if amount * PRICE > balance.as_f64().unwrap() {
        return false;
    }

    let stock = getAccountBalance(SELLER_PUBLIC_KEY,SALE_MOSAIC_ID).await;
    if amount > stock.as_f64().unwrap() {
        return false;
    }

    transferMosaic(SELLER_PUBLIC_KEY, buyer, SALE_MOSAIC_ID, amount, "Deliver mosaic").await;
    transferMosaic(buyer, SELLER_PUBLIC_KEY, CURRENCY_MOSAIC_ID, amount * PRICE, "Pay charge").await;

    return true;
}
