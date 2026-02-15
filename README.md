# NimbusFeed
An unofficial bot for notifying you and your Stoat server about NexusMods.com mod uploads and updates.
Uses the [stoatbot.js](https://jade3375.github.io/stoatbot.js/) library.

---
Built for use alongside a MySQL database:
Table: tracked_channels
channel_id (varchar) | game_name (varchar)
Table: recent_mods
game_name (varchar) | mod_id (bigint) | version (varchar) | updated_at (bigint)
