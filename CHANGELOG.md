# Changelog

## 0.2.0 — 2026-11-11

### Breaking

- Event and activity segment conditions take `within`, a duration such as
  `{ value: 30, unit: 'days' }`, in place of `withinDays`.

### Added

- Transactional email sends take `cc`, `bcc` and `mergeTags`. Each copy is its own
  message, with `copy` set; copies that can't be sent are listed in the result's
  `skippedCopies`.
- `messages.list()` filters on `sent`, `delivered`, `bounced` and `complained`.
- Messages carry the recipient's `firstName` and `lastName`.
- Contacts carry `purchaseCycle`, and segment rules can filter on
  `daysBetweenPurchases`, `purchaseOverdueRatio` and `purchaseCycleStatus`.
- Workspaces have `website`, `mailKind` and `contactOptIn`.
- Web event context takes `search`.
- Error code `SENDING_REVIEW_REQUIRED`, and the blocker codes `new_account_daily_limit`,
  `sending_review_required` and `marketing_contacts_limit_reached`.
- `POST /v1/sending-domains/{id}/review` retries safely through `kirora.request()`.

### Changed

- Web event context keeps the query string in `url`, and cuts over-long `url`, `search`,
  `referrer`, `path` and `title` values instead of refusing them.

## 0.1.0 — 2026-11-03

Initial release.
