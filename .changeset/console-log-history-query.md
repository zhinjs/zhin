---
"@zhin.js/host-http": patch
---

Add page/pageSize history retrieval, stable timestamp/id ordering, literal case-insensitive query and exact-source filters to Console logs. Existing limit calls retain their array response, with real filtered totals and stable row IDs. Source counts cover the full level/query result independently of the selected source or page. Literal queries match actual retained rows on the Host because the database LIKE operator does not provide a portable escape contract.
