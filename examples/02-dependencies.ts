/**
 * Example 2 — Smart Dependencies
 *
 * Shows how fields can reference each other.
 * The builder only shows defineX() when X's dependencies are satisfied.
 *
 * Key concepts:
 *   - $.ref("field")  — value must match the referenced field
 *   - $.keysOf(tag)   — extract keys from a field
 *   - $.merge(A, B)   — intersection of two types
 *   - $.record(keys, valueType) — dictionary with constrained keys
 */
import { schema, ty } from "../src";

// ============================================================
//  Scenario: Localized product card
// ============================================================
//
//  A product card has a primary locale, then locale-specific data
//  is keyed by that locale string. The price display format
//  depends on the currency.
//
//  Dependency graph:
//    locale ←── localizedTitle (keys from locale value)
//    currency ←── priceFormat (keys from currency value)
//
//  SmartBuilder enforces: defineLocale before defineLocalizedTitle,
//  defineCurrency before definePriceFormat. The rest is free.

const ProductCard = schema()
    .field("name", ty.string)
    .field("locale", ty.string)
    .field("currency", ty.string)
    .field("price", ty.number)

    // localizedTitle: a record { [locale]: string }
    // e.g. locale = "en" → { en: "Red Sneakers" }
    .field("localizedTitle", $ => $.record($.keysOf($.ref("locale")), $.string))

    // priceLabel: { formatted: string } & { [currency]: string }
    // e.g. currency = "usd" → { formatted: "$99.99", usd: "99.99" }
    .field("priceLabel", $ => $.merge(
        $.type<{ formatted: string }>(),
        $.record($.keysOf($.ref("currency")), $.string),
    ))

    // mirror: exact copy of priceLabel's resolved type
    .field("mirror", $ => $.ref("priceLabel"))
    .done();

// ── Usage ──

// Step 1: defineLocale, defineCurrency, defineName, definePrice (no deps)
// Step 2: defineLocalizedTitle (needs locale), definePriceLabel (needs currency)
// Step 3: defineMirror (needs priceLabel)

const sneakers = ProductCard
    .defineLocale("en")
    .defineCurrency("usd")
    .defineName("Red Sneakers")
    .definePrice(99.99)
    // ↓ now defineLocalizedTitle and definePriceLabel appear
    .defineLocalizedTitle({ en: "Red Running Sneakers" })
    .definePriceLabel({ formatted: "$99.99", usd: "99.99" })
    // ↓ now defineMirror appears (depends on priceLabel)
    .defineMirror({ formatted: "$99.99", usd: "99.99" })
    .build();

console.log(sneakers);


// ============================================================
//  Scenario: Object-keyed overrides
// ============================================================
//
//  Default settings → overrides dict with the SAME keys.
//  $.from("defaults") auto-detects Record → uses keyof.

const SettingsOverride = schema()
    .field("defaults", ty.object({
        theme: ty.type<"light" | "dark">(),
        language: ty.string,
        notifications: ty.boolean,
    }))
    // overrides: nullable version of each default key
    .field("overrides", $ => $.map($.ref("defaults"), () => $.nullable($.string)))
    .done();

const userPrefs = SettingsOverride
    .defineDefaults({ theme: "dark", language: "en", notifications: true })
    // ↓ keys constrained to "theme" | "language" | "notifications"
    .defineOverrides({ theme: "midnight", language: null, notifications: null })
    .build();

console.log(userPrefs);
