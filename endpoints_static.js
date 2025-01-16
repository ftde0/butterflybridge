module.exports = {"register": function(app) {
    app.get("/1/account/rate_limit_status.json", (req, res) => {
        res.status(200)
        res.send({
            "remaining_hits":150000,
            "reset_time": new Date(Date.now() + (1000 * 3600)).toISOString(),
            "hourly_limit":150000,
            "reset_time_in_seconds":1
        })
    })
    
    app.get("/1/trends/current.json", (req, res) => {
        res.status(200)
        res.send({
            "trends": {},
            "as_of": 1
        })
    })

    app.get("/1/direct_messages/sent.json", (req, res) => {
        res.redirect("/1/direct_messages.json?only_by_me=1")
    })

    app.get("/1/promoted_tweets/search.json", (req, res) => {
        let q = req.query.q;
        if(!q) {res.sendStatus(400);return;}
        res.redirect("/search.json?q=" + q)
    })

    app.get("/1/geo/reverse_geocode.json", (req, res) => {
        res.sendStatus(500);
    })

    // used from twitter docs, not all obviously implemented
    app.get("/1/help/configuration.json", (req, res) => {
        res.send({"non_username_paths": [
            "about",  "account",  "accounts",  "activity",  "all",
            "announcements",  "anywhere",  "api_rules",  "api_terms",
            "apirules",  "apps",  "auth",  "badges",  "blog",  "business",
            "buttons",  "contacts",  "devices",  "direct_messages",
            "download",  "downloads",  "edit_announcements",  "faq",
            "favorites",  "find_sources",  "find_users",  "followers",
            "following",  "friend_request",  "friendrequest",  "friends",
            "goodies",  "help",  "home",  "i",  "im_account",  "inbox",
            "invitations",  "invite",  "jobs",  "list",  "login",  "logo",
            "logout",  "me",  "mentions",  "messages",  "mockview",
            "newtwitter",  "notifications",  "nudge",  "oauth",
            "phoenix_search",  "positions",  "privacy",  "public_timeline",
            "related_tweets",  "replies",  "retweeted_of_mine",  "retweets",
            "retweets_by_others",  "rules",  "saved_searches",  "search",
            "sent",  "sessions",  "settings",  "share",  "signup",  "signin",
            "similar_to",  "statistics",  "terms",  "tos",  "translate",
            "trends",  "tweetbutton",  "twttr",  "update_discoverability",
            "users",  "welcome",  "who_to_follow",  "widgets",
            "zendesk_auth",  "media_signup"
        ]})
    })

    app.post("/1/statuses/destroy/*", (req, res) => {
        res.sendStatus(200)
    })
}}