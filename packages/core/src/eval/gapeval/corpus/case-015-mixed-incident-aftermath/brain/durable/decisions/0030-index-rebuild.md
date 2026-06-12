---
type: decision
acl: public
salience: 0.3
---

# 0030 · Full nightly index rebuild

Rebuild the whole search index nightly at 02:00. Simple to operate, but the
rebuild saturates IO on the primary shard.
