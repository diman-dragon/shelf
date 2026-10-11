package com.shelf.player;

import android.app.Activity;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Google Play Billing (Billing Library 8). Three kinds of products, all one-time:
 *   premium_lifetime   "Premium forever": bought once, must be acknowledged within 3 days (done here right away)
 *   tip_tea, tip_cat_treat, tip_cat_food   tips: consumed right after the payment so they can be bought again
 * There is no server: Google Play is the only record. The web side (billing.js) asks restore() at start.
 */
@CapacitorPlugin(name = "ShelfBilling")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {
  private static final String PREMIUM = "premium_lifetime";
  private static final String[] IDS = { PREMIUM, "tip_tea", "tip_cat_treat", "tip_cat_food" };

  private BillingClient client;
  private final Map<String, ProductDetails> details = new HashMap<>();

  @Override public void load() {
    client = BillingClient.newBuilder(getContext())
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build();
  }

  /** Runs `ok` once the connection to Google Play is up; rejects the call when there is no Google Play. */
  private void connected(final PluginCall call, final Runnable ok) {
    if (client.isReady()) { ok.run(); return; }
    client.startConnection(new BillingClientStateListener() {
      @Override public void onBillingSetupFinished(BillingResult r) {
        if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) ok.run();
        else call.reject("Google Play is not available (" + r.getResponseCode() + ")");
      }
      @Override public void onBillingServiceDisconnected() { /* the next call reconnects */ }
    });
  }

  @PluginMethod
  public void getProducts(final PluginCall call) {
    connected(call, new Runnable() { @Override public void run() {
      List<QueryProductDetailsParams.Product> list = new ArrayList<>();
      for (String id : IDS) {
        list.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
      }
      client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(list).build(),
          new com.android.billingclient.api.ProductDetailsResponseListener() {
            @Override public void onProductDetailsResponse(BillingResult r, QueryProductDetailsResult res) {
              JSArray arr = new JSArray();
              for (ProductDetails pd : res.getProductDetailsList()) {
                details.put(pd.getProductId(), pd);
                ProductDetails.OneTimePurchaseOfferDetails o = pd.getOneTimePurchaseOfferDetails();
                if (o == null) continue;
                JSObject p = new JSObject();
                p.put("id", pd.getProductId());
                p.put("price", o.getFormattedPrice());
                p.put("title", pd.getName());
                arr.put(p);
              }
              JSObject ret = new JSObject();
              ret.put("products", arr);
              call.resolve(ret);
            }
          });
    }});
  }

  @PluginMethod
  public void buy(final PluginCall call) {
    final String id = call.getString("id", "");
    connected(call, new Runnable() { @Override public void run() {
      final ProductDetails pd = details.get(id);
      if (pd == null) { call.reject("Product not loaded: " + id); return; }
      final Activity act = getActivity();
      if (act == null) { call.reject("No activity"); return; }
      final BillingFlowParams flow = BillingFlowParams.newBuilder()
          .setProductDetailsParamsList(Collections.singletonList(
              BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).build()))
          .build();
      act.runOnUiThread(new Runnable() { @Override public void run() {
        BillingResult r = client.launchBillingFlow(act, flow);
        if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) call.resolve();
        else call.reject("Could not start the payment (" + r.getResponseCode() + ")");
      }});
    }});
  }

  /** What Google Play says is owned right now; also finishes any purchase that was paid but not yet acknowledged / consumed. */
  @PluginMethod
  public void restore(final PluginCall call) {
    connected(call, new Runnable() { @Override public void run() {
      client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
          new com.android.billingclient.api.PurchasesResponseListener() {
            @Override public void onQueryPurchasesResponse(BillingResult r, List<Purchase> purchases) {
              JSObject ret = new JSObject();
              boolean ok = r.getResponseCode() == BillingClient.BillingResponseCode.OK;
              ret.put("ok", ok);
              JSArray owned = new JSArray();
              if (ok) {
                for (Purchase p : purchases) {
                  if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                  for (String id : p.getProducts()) {
                    if (PREMIUM.equals(id)) { owned.put(id); acknowledge(p); }
                    else consume(p);                        // a tip whose payment went through but was never consumed
                  }
                }
              }
              ret.put("owned", owned);
              call.resolve(ret);
            }
          });
    }});
  }

  @Override public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
    int code = r.getResponseCode();
    if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
      for (Purchase p : purchases) handle(p);
    } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
      emit("", "canceled");
    } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
      emit(PREMIUM, "purchased");                           // owned already: the web side unlocks, restore() acknowledges
    } else {
      emit("", "error");
    }
  }

  private void handle(Purchase p) {
    for (String id : p.getProducts()) {
      if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) { emit(id, "pending"); continue; }
      if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
      if (PREMIUM.equals(id)) acknowledge(p); else consume(p);
      emit(id, "purchased");
    }
  }

  private void acknowledge(Purchase p) {
    if (p.isAcknowledged()) return;
    client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
        new com.android.billingclient.api.AcknowledgePurchaseResponseListener() {
          @Override public void onAcknowledgePurchaseResponse(BillingResult r) { /* retried by the next restore() if it failed */ }
        });
  }

  private void consume(Purchase p) {
    client.consumeAsync(ConsumeParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
        new com.android.billingclient.api.ConsumeResponseListener() {
          @Override public void onConsumeResponse(BillingResult r, String token) { /* retried by the next restore() if it failed */ }
        });
  }

  private void emit(String id, String status) {
    JSObject e = new JSObject();
    e.put("id", id);
    e.put("status", status);
    notifyListeners("purchase", e);
  }
}
