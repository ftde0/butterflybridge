const express = require("express");
const config = require("./config.json")
const utils = require("./utils")

const app = express();
app.listen(config.port, () => {
    console.log("butterflybridge started!");
});

let fPoints = [
    "/config.json", "/bsky-data.json", "/tokens.json", "/userTokens.json",
    "/bsky-twitter.js", "/caching.js", "/endpoints_web.js", "/endpoints_static.js",
    "/endpoints_api.js", "/utils.js", "/.gitignore", "/.git", "/.git/*"
]
fPoints.forEach(point => {
    app.get(point, (req, res) => {
        res.sendStatus(403);
    })
})

app.use(express.static("./"))
app.use(express.raw({
    "type": () => true,
    "limit": "10mb"
}))

/*
endpoints_api.js: twitter and twitpic endpoints
- /2/upload.xml
- /oauth/access_token
- /1/statuses/home_timeline.json
- /1/account/verify_credentials.json
- /1/friendships/show.json
- /1/statuses/user_timeline.json
- /1/statuses/mentions.json
- /1/statuses/show/*
- /1/users/search.json
- /search.json
- /1/statuses/update.json
- /1/friendships/create.json
- /1/friendships/destroy.json
- /1/statuses/friends.json
- /1/statuses/followers.json
- /1/*\/lists.json
- /1/statuses/retweet/*
- /1/favorites/create/*
- /1/favorites/destroy/*
- /1/favorites.json
- /1/users/show.json
- /1/direct_messages.json
- /1/direct_messages/new.json
*/
require("./endpoints_api").register(app)

/*
endpoints_static.js: redirects / endpoints that don't change
- /1/account/rate_limit_status.json
- /1/trends/current.json
- /1/help/configuration.json
- /1/direct_messages/sent.json
- /1/geo/reverse_geocode.json
- /1/statuses/destroy/*
- /1/promoted_tweets/search.json
*/
require("./endpoints_static").register(app)

/*
endpoints_web.js: most non-api endpoints
- /av_proxy
- /view_imgs
- /process_video
*/
require("./endpoints_web").register(app)

app.get("/1/*/lists/subscriptions.json", (req, res, next) => {
    if(!req.originalUrl.includes("subscriptions.json")) {
        next()
        return;
    }
    res.send({"lists":[],"next_cursor":0})
})

app.get("/*", (req, res) => {
    if(req.originalUrl.includes("/status/")) {
        utils.route_status(req, res);
        return;
    }
    res.sendStatus(404)
    return;
})
process.on("unhandledRejection", (e) => {console.log(e)})
process.on("uncaughtException", (e) => {console.log(e)})