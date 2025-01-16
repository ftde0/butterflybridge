const utils = require("./utils")
const cache = require("./caching")
const fetch = require("node-fetch")
const config = require("./config.json")
const fs = require("fs")
const absPath = "http://" + config.ip + ":" + config.port
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"

let userTokens = {}
if(fs.existsSync("./userTokens.json")) {
    userTokens = require("./userTokens.json")
}
let convoLookupTable = []

function shouldRefresh(req) {
    let tokens = userTokens[req.headers["x-client-uuid"]]
    return (Date.now() > (tokens.lastUpdate + (1000 * 60 * 55)))
}
function handleToken(req, callback) {
    let tokens = JSON.parse(JSON.stringify(userTokens[req.headers["x-client-uuid"]]))
    
    if(shouldRefresh(req)) {
        fetch("https://bsky.social/xrpc/com.atproto.server.refreshSession", {
            "credentials": "include",
            "headers": {
                "User-Agent": ua,
                "Accept": "*/*",
                "Accept-Language": "pl,en-US;q=0.7,en;q=0.3",
                "authorization": "Bearer " + decryptWthIk(tokens.refresh),
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "Priority": "u=4"
            },
            "referrer": "https://bsky.app/",
            "method": "POST",
            "mode": "cors"
        }).then(r => {r.json().then(r => {
            let uuid = req.headers["x-client-uuid"]
            userTokens[uuid].lastUpdate = Date.now()
            userTokens[uuid].access = encryptWithIk(r.accessJwt);
            userTokens[uuid].refresh = encryptWithIk(r.refreshJwt);
            try {
                if(r.didDoc.service[0].serviceEndpoint) {
                    userTokens[uuid].site = r.didDoc.service[0].serviceEndpoint
                }
            }
            catch(error) {
                console.log(error, r)
            }
            fs.writeFileSync("./userTokens.json", JSON.stringify(userTokens))
            callback()
        })})
    } else {
        callback()
    }
}
function createHeaders(req) {
    let tokens = userTokens[req.headers["x-client-uuid"]]
    let content_type = "application/json"
    return {
        "user-agent": ua,
        "Priority": "u=0",
        "x-bsky-topics": "",
        "atproto-accept-labelers": "did:plc:ar7c4by46qjdydhdevvrndac;redact",
        "authorization": "Bearer " + decryptWthIk(tokens.access),
        "Referer": "https://bsky.app/",
        "content-type": content_type
    }
}


module.exports = {"register": function(app) {
    app.post("/oauth/access_token", (req, res) => {
        if(!req.headers["x-client-uuid"]) {
            res.status(400)
            res.send("missing x-client-uuid header")
            return;
        }
        if(userTokens[req.headers["x-client-uuid"]]) {
            // already logged in.. somehow?
            res.status(200)
            res.send(`oauth_token=amogus&oauth_token_secret=sugoma`)
            return;
        }
        if(config.test_noCreateAuth) {
            res.sendStatus(500)
            return;
        }
        let username = decodeURIComponent(req.query.x_auth_username)
        let pwd = decodeURIComponent(req.query.x_auth_password)
        let mfa = ""
        let bridgeAuth = false;
        if(pwd.includes("+2FA-")) {
            mfa = pwd.split("+2FA-")[1].split("+")[0].split("-")[0]
            pwd = pwd.replace("+2FA-" + mfa, "")
        }
        if(pwd.includes("+BRIDGE-")) {
            bridgeAuth = pwd.split("+BRIDGE-")[1].split("+")[0].split("-")[0]
            pwd = pwd.replace("+BRIDGE-" + bridgeAuth, "")
        }
        if(config.tokens && (!bridgeAuth || !config.tokens.includes(bridgeAuth))) {
            res.sendStatus(401)
            return;
        }
        fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
            "headers": {
                "user-agent": ua,
                "Priority": "u=0",
                "x-bsky-topics": "",
                "Referer": "https://bsky.app/",
                "content-type": "application/json"
            },
            "method": "POST",
            "body": JSON.stringify({
                "authFactorToken": mfa,
                "identifier": username,
                "password": pwd
            })
        }).then(r => {
            if(r.status !== 200) {
                res.sendStatus(r.status)
                return;
            }
            r.json().then(r => {
                let uuid = req.headers["x-client-uuid"]
                userTokens[uuid] = {
                    "access": encryptWithIk(r.accessJwt),
                    "refresh": encryptWithIk(r.refreshJwt),
                    "lastUpdate": Date.now(),
                    "site": r.didDoc.service[0].serviceEndpoint
                }
                fs.writeFileSync("./userTokens.json", JSON.stringify(userTokens))
                res.status(200)
                res.send(`oauth_token=amogus&oauth_token_secret=sugoma`)
            })
        })
    })

    app.get("/1/account/verify_credentials.json", (req, res) => {
        //let tokens = userTokens[req.headers["x-client-uuid"]]
        let user = {}
        getCurrentUser(req, (data) => {
            let did = data.did;
            pullUserByDid(req, did, (userData) => {
                user = userData;
                getFirstStatus(req, did, (status) => {
                    user.status = status;
                    res.send(user)
                })
            })
        })
    })

    let uploadContentTypes = {}
    app.post("/2/upload.xml", (req, res) => {
        let sep = "Content-Transfer-Encoding: binary"
        let metadata = req.body.toString().split(sep)[0]
        let offset = metadata.length + sep.length + 1;
        let file = req.body.slice(offset)
        while(file[0] <= 20) {
            file = file.slice(1)
        }
        let fname = "img" + Date.now()
        let ext = "jpg"
        let ct = "image/jpeg"
        try {
            ct = metadata.split(`Content-Type: `)[1]
                         .split("\n")[0].split(" ")[0]
                         .split(";")[0].split("\r")[0];
            switch(ct) {
                case "image/png": {
                    ext = "png"
                    break;
                }
                case "image/gif": {
                    ext = "gif"
                    break;
                }
                case "image/webp": {
                    ext = "webp"
                    break;
                }
            }
        }
        catch(error){}
        uploadContentTypes[fname + "." + ext] = ct;
        if(!fs.existsSync("./bsky-imgs/")) {
            fs.mkdirSync(__dirname + "/bsky-imgs/")
        }
        fs.writeFile("bsky-imgs/" + fname + "." + ext, file, (e) => {
            if(!e) {
                res.status(200)
                res.send(`<?xml version="1.0" encoding="UTF-8"?>
                <data>
                    <url>${absPath}/bsky-imgs/${fname}.${ext}</url>
                </data>`)
            } else {
                res.sendStatus(500)
            }
        })
    })

    app.get("/1/statuses/home_timeline.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!tokens) {
            res.sendStatus(401)
            return;
        }
        let uuid = req.headers["x-client-uuid"] || 1
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.getTimeline",
                "?limit=20"
            ]
            if(req.query.max_id) {
                path.push("&cursor=" + cache.getTable("tempCursors")[uuid]);
            }
            path = path.join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {
                if(r.status !== 200) {
                    res.sendStatus(r.status)
                    return;
                }
                r.json().then(r => {
                    let posts = []
                    r.feed.forEach(p => {
                        try {
                            let s = utils.parsePost(p.post)
                            if(s) {posts.push(s)}
                        }
                        catch(error) {}
                    })
                    if(r.cursor) {
                        cache.write("tempCursors", uuid, r.cursor);
                    }
                    cache.commitChanges()
                    res.send(posts)
                })
            })
        })
    })

    app.get("/1/friendships/show.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let target = req.query.target_id;
        if(!target || !cache.getTable("userLookupTable")[target]) {
            res.sendStatus(400);
            return;
        }
        res.status(200)
        handleToken(req, () => {
            utils.getIdFromHandle(cache.getTable("userLookupTable")[target], (did) => {
                let path = [
                    tokens.site,
                    "/xrpc/app.bsky.actor.getProfile",
                    "?actor=" + did
                ].join("")
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    let userFollowing = false;
                    if(r.viewer.following) {
                        userFollowing = true;
                    }
                    let userFollowed = false;
                    if(r.viewer.followedBy) {
                        userFollowing = true;
                    }
                    res.send({
                        "relationship": {
                            "source": {
                                "following": userFollowing,
                                "followed_by": userFollowed
                            },
                            "target": {
                                "id": parseInt(target),
                                "id_str": target.toString(),
                                "screen_name": r.handle,
                                "following": userFollowing,
                                "followed_by": userFollowed,
                                "following_received": null,
                                "following_requested": null
                            }
                        }
                    })
                })})
            })
        })
    })


    app.get("/1/statuses/user_timeline.json", (req, res) => {
        if(!req.query.user_id
        || !cache.getTable("userLookupTable")[req.query.user_id]) {
            res.sendStatus(404);
            return;
        }
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let uuid = req.headers["x-client-uuid"] || 1
        res.status(200)
        let pullAttemts = 0;
        function pull(cursor) {
            pullAttemts++
            let handle = cache.getTable("userLookupTable")[req.query.user_id]
            handleToken(req, () => {
                utils.getIdFromHandle(handle, (did) => {
                    let path = [
                        tokens.site,
                        "/xrpc/app.bsky.feed.getAuthorFeed",
                        "?actor=" + did,
                        "&filter=posts_and_author_threads",
                        "&limit=30"
                    ]
                    if(req.query.max_id || cursor) {
                        path.push("&cursor=" + cache.getTable("tempCursors")[uuid]);
                    }
                    path = path.join("")
                    fetch(path, {
                        "headers": createHeaders(req),
                        "method": "GET"
                    }).then(r => {r.json().then(r => {
                        let posts = []
                        r.feed.forEach(p => {
                            try {
                                let s = utils.parsePost(p.post)
                                if(s) {posts.push(s)}
                            }
                            catch(error) {}
                        })
                        if(r.cursor) {
                            cache.write("tempCursors", uuid, r.cursor);
                        }
                        if(posts.length == 0 && r.cursor && pullAttemts < 3) {
                            pull(r.cursor)
                            return;
                        }
                        cache.commitChanges()
                        res.send(posts)
                    })})
                })
            })
        }
        pull()
    })

    app.get("/1/statuses/mentions.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        //let uuid = req.headers["x-client-uuid"] || 1
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.notification.listNotifications",
                "?limit=40",
            ]
            path = path.join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let posts = []
                r.notifications.forEach(n => {
                    try {
                        if(n.reason == "reply" || n.reason == "mention") {
                            let replyId = false;
                            let s = utils.parsePost(n, replyId)
                            if(s) {posts.push(s)}
                        }
                    }
                    catch(error) {
                        console.log(error)
                    }
                })
                cache.commitChanges()
                res.send(posts)
            })})
        })
    })

    app.get("/1/statuses/show/*", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let statusId = req.originalUrl.split("/show/")[1].split(".json")[0]
        if(!cache.getTable("postLookupTable")[statusId]) {
            res.sendStatus(404);
            return;
        }
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.getPostThread",
                "?uri=" + cache.getTable("postLookupTable")[statusId][0],
                "&depth=0"
            ]
            path = path.join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                try {
                    let post = utils.parsePost(r.thread.post);
                    if(post) {res.send([post])}
                }
                catch(error){}
            })})
        })
    })

    app.get("/1/users/search.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let q = req.query.q;
        if(!q) {res.sendStatus(400);return;}
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.actor.searchActors",
                "?q=" + req.query.q,
                "&limit=20",
            ].join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let users = []
                r.actors.forEach(a => {
                    try {
                        let id = new Date(a.createdAt).getTime()
                        users.push({
                            "id": id,
                            "id_str": id.toString(),
                            "name": a.displayName || a.handle,
                            "screen_name": a.handle,
                            "description": a.description || "",
                            "url": "https://bsky.app/profile/" + a.handle,
                            "followers_count":0,
                            "friends_count":0,
                            "favourites_count":0,
                            "statuses_count":1,
                            "created_at": utils.twitterDate(a.createdAt),
                            "profile_image_url": [
                                absPath,
                                "/av_proxy?r=",
                                encodeURIComponent(
                                    a.avatar.replace("/avatar/", "/avatar_thumbnail/")
                                )
                            ].join("")
                        })
                        cache.write("userLookupTable", id, a.handle)
                    }
                    catch(error) {
                        console.log(error)
                    }
                })
                cache.commitChanges()
                res.send(users)
            })})
        })
    })

    app.get("/search.json", (req, res) => {
        let uuid = req.headers["x-client-uuid"] || 1
        let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!req.query.q) {res.sendStatus(400);return;}
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.searchPosts",
                "?q=" + req.query.q,
                "&sort=latest",
                "&limit=20",
            ]
            if(req.query.max_id) {
                path.push("&cursor=" + cache.getTable("tempCursors")[uuid]);
            }
            path = path.join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let posts = []
                r.posts.forEach(p => {
                    try {
                        let r = p.record;
                        let a = p.author;
                        cache.write(
                            "userLookupTable",
                            new Date(a.createdAt).getTime(),
                            a.handle
                        )
                        let id = new Date(r.createdAt).getTime()
                        cache.write("postLookupTable", id, [p.uri, p.cid])
                        posts.push({
                            "created_at": utils.twitterDate(r.createdAt, "search"),
                            "from_user": a.handle,
                            "from_user_id": new Date(a.createdAt).getTime(),
                            "from_user_name": a.handle,
                            "id": id,
                            "id_str": id.toString(),
                            "iso_language_code": ((r.langs && r.langs[0])
                                                   ? r.langs[0] : "en"),
                            "metadata": {
                                "result_type": (req.query.result_type
                                               ? req.query.result_type : "recent")
                            },
                            "profile_image_url": [
                                absPath,
                                "/av_proxy?r=",
                                encodeURIComponent(
                                    a.avatar.replace("/avatar/", "/avatar_thumbnail/")
                                )
                            ].join(""),
                            "source": "a",
                            "text": r.text,
                            "to_user": null
                        })
                    }
                    catch(error) {
                        console.log(error)
                    }
                })
                if(r.cursor) {
                    cache.write("tempCursors", uuid, r.cursor)
                }
                cache.commitChanges()
                res.send({"results": posts})
            })})
        })
    })

    app.post("/1/statuses/update.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!req.query.status
        && req.query.status.length > 0
        && req.query.status.length <= 300) {
            res.sendStatus(400);
            return;
        }
        let attachments = []
        let attachmentsUploaded = 0;
        if(decodeURIComponent(req.query.status).includes("bsky-imgs/")) {
            let words = decodeURIComponent(req.query.status).split(" ")
            let imgs = words.filter(s => s.includes("bsky-imgs/"))
            req.query.status = words.filter(s => !s.includes("bsky-imgs/")).join(" ")
            imgs.forEach(i => {
                i = i.split("bsky-imgs/")[1]
                if(fs.existsSync("./bsky-imgs/" + i)
                && uploadContentTypes[i]) {
                    attachments.push(i)
                }
            })
    
            attachments.forEach(f => {
                // upload files to bsky
                handleToken(req, () => {
                    let path = tokens.site + "/xrpc/com.atproto.repo.uploadBlob"
                    let headers = createHeaders(req)
                    headers["content-type"] = uploadContentTypes[f]
                    fetch(path, {
                        "headers": headers,
                        "method": "POST",
                        "body": fs.readFileSync("./bsky-imgs/" + f)
                    }).then(r => {r.json().then(r => {
                        let blob = r.blob
                        if(postData.value.embed && postData.value.embed.images) {
                            postData.value.embed.images.push({
                                "alt": "",
                                "image": blob
                            })
                        } else {
                            postData.value.embed = {
                                "$type": "app.bsky.embed.images",
                                "images": [{
                                    "alt": "",
                                    "image": blob
                                }]
                            }
                        }
                        attachmentsUploaded++
                        if(attachmentsUploaded == attachments.length) {
                            commitUpdate()
                        }
                    })})
                })
            })
        }
        function commitUpdate() {
            handleToken(req, () => {
                fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    let did = r.did
                    let path = tokens.site + "/xrpc/com.atproto.repo.applyWrites"
                    fetch(path, {
                        "headers": createHeaders(req),
                        "method": "POST",
                        "body": JSON.stringify({
                            "repo": did,
                            "validate": true,
                            "writes": [postData]
                        })
                    }).then(r => {r.json().then(r => {
                        let uri = r.results[0].uri
                        path = [
                            tokens.site,
                            "/xrpc/app.bsky.feed.getPostThread",
                            "?uri=" + uri,
                            "&depth=0"
                        ].join("")
                        fetch(path, {
                            "headers": createHeaders(req),
                            "method": "GET"
                        }).then(r => {r.json().then(r => {
                            try {
                                let post = utils.parsePost(r.thread.post);
                                if(post) {res.send(post)}
                                cache.commitChanges()
                            }
                            catch(error){res.sendStatus(200)}
                        })})
                    })})
                })})
            })
        }
    
        let postData = {
            "$type": "com.atproto.repo.applyWrites#create",
            "collection": "app.bsky.feed.post",
            "value": {
                "$type": "app.bsky.feed.post",
                "createdAt": new Date().toISOString(),
                "text": decodeURIComponent(req.query.status)
            }
        }
        let reply = req.query.in_reply_to_status_id
        let waitForReply = false;
        if(reply && cache.getTable("postLookupTable")[reply]) {
            waitForReply = true;
            postData.value.reply = {
                "parent": {
                    "uri": cache.getTable("postLookupTable")[reply][0],
                    "cid": cache.getTable("postLookupTable")[reply][1]
                }
            }
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.getPostThread",
                "?uri=" + cache.getTable("postLookupTable")[reply][0],
                "&depth=10"
            ].join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                try {
                    let parent = r.thread.parent;
                    if(parent) {
                        while(parent && parent.parent) {
                            parent = parent.parent;
                        }
                        let post = parent.post;
                        postData.value.reply.root = {
                            "uri": post.uri,
                            "cid": post.cid
                        }
                        commitUpdate()
                    } else {
                        postData.value.reply.root = {
                            "uri": cache.getTable("postLookupTable")[reply][0],
                            "cid": cache.getTable("postLookupTable")[reply][1]
                        }
                        commitUpdate()
                    }
                }
                catch(error){console.log(error)}
            })})
        }
        if(attachments.length == 0 && !waitForReply) {
            commitUpdate()
        }
    })

    app.post("/1/friendships/create.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let user = req.query.user_id;
        if(!user || !cache.getTable("userLookupTable")[user]) {
            res.sendStatus(404);
            return;
        }
        
        function createResponse() {
            let post = {}
            pullUserByDid(req, targetDid, (data) => {
                let path = [
                    tokens.site,
                    "/xrpc/app.bsky.feed.getAuthorFeed",
                    "?actor=" + targetDid,
                    "&filter=posts_and_author_threads",
                    "&limit=1"
                ].join("")
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    try {
                        let s = utils.parsePost(r.feed[0].post)
                        if(s) {post = s;}
                    }
                    catch(error) {}
    
                    data.status = post;
                    res.send(data)
                })})
            })
        }
    
        function createFollow() {
            fetch(tokens.site + "/xrpc/com.atproto.repo.createRecord", {
                "headers": createHeaders(req),
                "method": "POST",
                "body": JSON.stringify({
                    "repo": selfDid,
                    "collection": "app.bsky.graph.follow",
                    "record": {
                        "$type": "app.bsky.graph.follow",
                        "createdAt": new Date().toISOString(),
                        "subject": targetDid
                    }
                })
            }).then(r => {r.json().then(r => {
                let rkey = r.uri.split("/")
                rkey = rkey[rkey.length - 1]
                cache.write("rkeyLookupTable", 0, [
                    rkey, "follow", selfDid + "/" + targetDid, req.headers["x-client-uuid"] || "1"
                ])
                cache.commitChanges()
                createResponse()
            })})
        }
    
        let selfDid = ""
        let targetDid = ""
        utils.getIdFromHandle(cache.getTable("userLookupTable")[user], (t) => {
            targetDid = t;
            if(targetDid && selfDid) {
                createFollow()
            }
        })
        getCurrentUser(req, (r) => {
            selfDid = r.did;
            if(selfDid && targetDid) {
                createFollow()
            }
        })
    })

    app.post("/1/friendships/destroy.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let user = req.query.user_id;
        if(!user || !cache.getTable("userLookupTable")[user]) {
            res.sendStatus(404);
            return;
        }
        
        function createResponse() {
            let post = {}
            pullUserByDid(req, targetDid, (data) => {
                let path = [
                    tokens.site,
                    "/xrpc/app.bsky.feed.getAuthorFeed",
                    "?actor=" + targetDid,
                    "&filter=posts_and_author_threads",
                    "&limit=1"
                ].join("")
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    try {
                        let s = utils.parsePost(r.feed[0].post)
                        if(s) {post = s;}
                    }
                    catch(error) {}
    
                    data.status = post;
                    res.send(data)
                })})
            })
        }
    
        function destroyFollow() {
            let rkeyLookupTable = cache.getTable("rkeyLookupTable")
            let rkey = rkeyLookupTable.filter(s => (
                s[1] == "follow" && s[2] == selfDid + "/" + targetDid
            ))[0]
            fetch(tokens.site + "/xrpc/com.atproto.repo.deleteRecord", {
                "headers": createHeaders(req),
                "method": "POST",
                "body": JSON.stringify({
                    "repo": selfDid,
                    "collection": "app.bsky.graph.follow",
                    "rkey": rkey
                })
            }).then(r => {r.json().then(r => {
                rkeyLookupTable = rkeyLookupTable.filter(s => (
                    s[0] !== rkey && s[1] !== "follow" && s[2] !== selfDid + "/" + targetDid
                ))
                cache.write("rkeyLookupTable", 0, rkeyLookupTable, true)
                cache.commitChanges()
                createResponse()
            })})
        }
    
        let selfDid = ""
        let targetDid = ""
        utils.getIdFromHandle(cache.getTable("userLookupTable")[user], (t) => {
            targetDid = t;
            if(targetDid && selfDid) {
                destroyFollow()
            }
        })
        getCurrentUser(req, (r) => {
            selfDid = r.did;
            if(selfDid && targetDid) {
                createFollow()
            }
        })
    })

    let tokenRequestCount = {}
    app.get("/1/statuses/friends.json", (req, res) => {
        let user = req.headers["x-client-uuid"] || "1"
        let tokens = userTokens[user]
        if(!tokenRequestCount[user]) {
            tokenRequestCount[user] = 0;
            setTimeout(() => {
                tokenRequestCount[user] = 0;
            }, 30000)
        }
        tokenRequestCount[user]++
        if(tokenRequestCount[user] >= 5) {
            return;
        }
    
    
        res.status(200)
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.getTimeline",
                "?limit=30"
            ].join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let users = []
                r.feed.forEach(p => {if(p.post) {
                    try {
                        p = p.post;
                        let r = p.record;
                        let authorId = new Date(p.author.createdAt).getTime();
                        if(!users.filter(s => s.id == authorId)[0]
                        && (p.author.viewer.following
                        && p.author.viewer.followedBy)
                        && r.text.length >= 1) {
                            // mutual & not added already
                            cache.getTable("userLookupTable")[authorId] = p.author.handle
                            users.push({
                                "created_at": utils.twitterDate(p.author.createdAt),
                                "favourites_count":0,
                                "followers_count":0,
                                "friends_count":0,
                                "statuses_count":1,
                                "description":"",
                                "id": authorId,
                                "id_str": authorId.toString(),
                                "name": p.author.displayName,
                                "profile_image_url": [
                                    absPath,
                                    "/av_proxy?r=",
                                    encodeURIComponent(p.author.avatar.replace(
                                        "/avatar/", "/avatar_thumbnail/"
                                    ))
                                ].join(""),
                                "screen_name": p.author.handle,
                                "status": {
                                    "created_at": utils.twitterDate(r.createdAt),
                                    "id": new Date(r.createdAt).getTime(),
                                    "id_str": new Date(r.createdAt).getTime().toString(),
                                    "source": "device",
                                    "text": r.text
                                }
                            })
                        }
                    }
                    catch(error){console.log(error)}
                }})
                cache.commitChanges()
                res.send({"users": users})
            })})
        })
    })

    app.get("/1/statuses/followers.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let followers = []
        let followersIndexed = 0;
    
        function addFollower(user) {
            // pull first status from user
            let userObject = {
                "id": user.id,
                "name": user.displayName || user.handle,
                "screen_name": user.handle,
                "description": user.description || "",
                "url": "https://bsky.app/profile/" + user.handle,
                "followers_count": 0,
                "friends_count": 0,
                "created_at": utils.twitterDate(user.createdAt),
                "favourites_count": 0,
                "statuses_count": 1,
                "profile_image_url": [
                    absPath,
                    "/av_proxy?r=",
                    encodeURIComponent(
                        user.avatar.replace("/avatar/", "/avatar_thumbnail/")
                    )
                ].join("")
            }
            getFirstStatus(req, did, (status) => {
                userObject.status = status;
                followers.push(userObject)
                if(followers.length >= followersIndexed) {
                    res.send({"users": followers})
                    cache.commitChanges()
                }
            })
        }
    
        res.status(200)
        handleToken(req, () => {
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let did = r.did
                let path = [
                    tokens.site,
                    "/xrpc/app.bsky.graph.getFollowers",
                    "?actor=" + did,
                    "&limit=10"
                ].join("")
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    followersIndexed = r.followers.length
                    r.followers.forEach(f => {
                        let id = new Date(f.createdAt).getTime()
                        f.id = id;
                        addFollower(f)
                    })
                })})
            })})
        })
    })

    app.get("/1/*/lists.json", (req, res, next) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!req.originalUrl.includes("lists.json")) {
            next()
            return;
        }
        let user = req.originalUrl.split("/1/")[1].split("/lists")[0]
        if(!cache.getTable("userLookupTable")[user]) {
            res.sendStatus(404);
            return;
        }
        handleToken(req, () => {
            utils.getIdFromHandle(cache.getTable("userLookupTable")[user], (did) => {
                let path = [
                    tokens.site,
                    "/xrpc/app.bsky.graph.getLists",
                    "?actor=" + did,
                    "&limit=20",
                ].join("")
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    let lists = []
                    if(r.lists) {r.lists.forEach(l => {
                        let id = new Date(l.indexedAt).getTime()
                        cache.getTable("listLookupTable")[id] = l;
                        let sid = l.uri.split("/")
                        let authorId = new Date(l.creator.createdAt).getTime()
                        cache.getTable("userLookupTable")[authorId] = l.creator.handle
                        sid = sid[sid.length - 1]
                        let url = [
                            `https://bsky.app/profile/${l.creator.handle}/`,
                            `lists/${sid}`
                        ].join("")
                        lists.push({
                            "slug": id.toString(),
                            "name": id.toString(),
                            "created_at": utils.twitterDate(id),
                            "uri": url,
                            "id_str": id.toString(),
                            "subscriber_count": 0,
                            "member_count": 0,
                            "mode": "public",
                            "id": id,
                            "full_name": l.name,
                            "description": l.description,
                            "user": {
                                "name": l.creator.displayName,
                                "created_at": utils.twitterDate(l.creator.createdAt),
                                "profile_image_url": [
                                    absPath,
                                    "/av_proxy?r=",
                                    encodeURIComponent(l.creator.avatar.replace(
                                        "/avatar/", "/avatar_thumbnail/"
                                    ))
                                ].join(""),
                                "id_str": authorId.toString(),
                                "id": authorId,
                                "followers_count":0,
                                "friends_count":0,
                                "screen_name": l.creator.handle
                            }
                        })
                    })}
                    cache.commitChanges()
                    res.send({"lists":lists,"next_cursor":0,"previous_cursor":0})
                })})
            })
        })
    })

    app.post("/1/statuses/retweet/*", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let status = req.originalUrl.split("statuses/retweet/")[1]
                                    .split("?")[0]
                                    .split(".json")[0]
        if(!status || !cache.getTable("postLookupTable")[status]) {
            res.sendStatus(404);
            return;
        }
        let post = cache.getTable("postLookupTable")[status]
        handleToken(req, () => {
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let did = r.did
                let path = tokens.site + "/xrpc/com.atproto.repo.createRecord"
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "POST",
                    "body": JSON.stringify({
                        "repo": did,
                        "collection": "app.bsky.feed.repost",
                        "record": {
                            "$type": "app.bsky.feed.repost",
                            "createdAt": new Date().toISOString(),
                            "subject": {
                                "uri": post[0],
                                "cid": post[1]
                            }
                        }
                    })
                }).then(r => {r.json().then(r => {
                    let rkey = r.uri.split("/")
                    rkey = rkey[rkey.length - 1]
                    cache.write("rkeyLookupTable", 0, [
                        rkey, "repost", status, req.headers["x-client-uuid"] || "1"
                    ])
                    path = [
                        tokens.site,
                        "/xrpc/app.bsky.feed.getPostThread",
                        "?uri=" + post[0],
                        "&depth=0"
                    ].join("")
                    fetch(path, {
                        "headers": createHeaders(req),
                        "method": "GET"
                    }).then(r => {r.json().then(r => {
                        try {
                            let post = utils.parsePost(r.thread.post);
                            if(post) {res.send(post)}
                            cache.commitChanges()
                        }
                        catch(error){res.sendStatus(200)}
                    })})
                })})
            })})
        })
    })

    app.post("/1/favorites/create/*", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let status = req.originalUrl.split("favorites/create/")[1]
                                    .split("?")[0]
                                    .split(".json")[0]
        if(!status || !cache.getTable("postLookupTable")[status]) {
            res.sendStatus(404);
            return;
        }
        let post = cache.getTable("postLookupTable")[status]
        handleToken(req, () => {
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let did = r.did
                let path = tokens.site + "/xrpc/com.atproto.repo.createRecord"
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "POST",
                    "body": JSON.stringify({
                        "repo": did,
                        "collection": "app.bsky.feed.like",
                        "record": {
                            "$type": "app.bsky.feed.like",
                            "createdAt": new Date().toISOString(),
                            "subject": {
                                "uri": post[0],
                                "cid": post[1]
                            }
                        }
                    })
                }).then(r => {r.json().then(r => {
                    let rkey = r.uri.split("/")
                    rkey = rkey[rkey.length - 1]
                    cache.write("rkeyLookupTable", 0, [
                        rkey, "like", status, req.headers["x-client-uuid"] || "1"
                    ])
                    path = [
                        tokens.site,
                        "/xrpc/app.bsky.feed.getPostThread",
                        "?uri=" + post[0],
                        "&depth=0"
                    ].join("")
                    fetch(path, {
                        "headers": createHeaders(req),
                        "method": "GET"
                    }).then(r => {r.json().then(r => {
                        try {
                            let post = utils.parsePost(r.thread.post);
                            if(post) {res.send(post)}
                            cache.commitChanges()
                        }
                        catch(error){res.sendStatus(200)}
                    })})
                })})
            })})
        })
    })

    app.post("/1/favorites/destroy/*", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let status = req.originalUrl.split("favorites/destroy/")[1]
                                    .split("?")[0]
                                    .split(".json")[0]
        if(!status || !cache.getTable("postLookupTable")[status]) {
            res.sendStatus(404);
            return;
        }
        let client = req.headers["x-client-uuid"] || "1"
        let rkey = cache.getTable("rkeyLookupTable").filter(s => (
            s[1] == "like" && s[2] == status && s[3] == client
        ))
        console.log(rkey)
        if(!rkey[0]) {
            res.sendStatus(404);
            return;
        }
        rkey = rkey[0][0]
        handleToken(req, () => {
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                let did = r.did
                let path = tokens.site + "/xrpc/com.atproto.repo.deleteRecord"
                console.log({
                    "repo": did,
                    "collection": "app.bsky.feed.like",
                    "rkey": rkey
                })
                fetch(path, {
                    "headers": createHeaders(req),
                    "method": "POST",
                    "body": JSON.stringify({
                        "repo": did,
                        "collection": "app.bsky.feed.like",
                        "rkey": rkey
                    })
                }).then(r => {console.log(r.status);r.json().then(r => {
                    console.log(r)
                    let rkeyLookupTable = cache.getTable("rkeyLookupTable")
                    rkeyLookupTable = rkeyLookupTable.filter(s => (
                        s[0] !== rkey && s[3] !== client
                    ))
                    cache.write("rkeyLookupTable", 0, rkeyLookupTable, true)
                    path = [
                        tokens.site,
                        "/xrpc/app.bsky.feed.getPostThread",
                        "?uri=" + cache.getTable("postLookupTable")[status][0],
                        "&depth=0"
                    ].join("")
                    fetch(path, {
                        "headers": createHeaders(req),
                        "method": "GET"
                    }).then(r => {r.json().then(r => {
                        try {
                            let post = utils.parsePost(r.thread.post);
                            if(post) {res.send(post)}
                            cache.commitChanges()
                        }
                        catch(error){console.log(error);res.sendStatus(200)}
                    })})
                })})
            })})
        })
    })

    app.get("/1/favorites.json", (req, res, next) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let requester = req.headers["x-client-uuid"] || 1
        if((!req.query.id || !cache.getTable("userLookupTable")[req.query.id])
        && req.query.id !== "38895958") {
           res.sendStatus(400);
           return; 
        }
        function getLikesByDid(did) {
            let path = [
                tokens.site,
                "/xrpc/app.bsky.feed.getActorLikes",
                "?actor=" + did,
                "&limit=20",
            ]
            if(req.query.max_id) {
                path.push("&cursor=" + cache.getTable("tempCursors")[requester]);
            }
            path = path.join("")
            fetch(path, {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {
                if(r.status !== 200) {
                    res.send([])
                    return;
                }
                r.json().then(r => {
                    let posts = []
                    r.feed.forEach(p => {
                        try {
                            let s = utils.parsePost(p.post)
                            if(s) {posts.push(s)}
                        }
                        catch(error) {}
                    })
                    if(r.cursor) {
                        cache.write("tempCursors", requester, r.cursor)
                    }
                    cache.commitChanges()
                    res.send(posts)
                })
            })
        }
        res.status(200)
        let user = req.query.id;
        if(user == "38895958") {
            // self
            handleToken(req, () => {
                fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                    "headers": createHeaders(req),
                    "method": "GET"
                }).then(r => {r.json().then(r => {
                    let did = r.did
                    getLikesByDid(did)
                })})
            })
        } else {
            handleToken(req, () => {
                utils.getIdFromHandle(cache.getTable("userLookupTable")[user], (did) => {
                    getLikesByDid(did)
                })
            })
        }
    })

    app.get("/1/users/show.json", (req, res) => {
        //let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!req.query.user_id
        || !cache.getTable("userLookupTable")[req.query.user_id]) {
            res.sendStatus(404)
            return;
        }
        let user = cache.getTable("userLookupTable")[req.query.user_id]
        utils.getIdFromHandle(user, (did) => {
            handle = user
            handleToken(req, () => {
                pullUserByDid(req, did, (data) => {
                    res.send(data)
                })
            })
        })
    })

    app.get("/1/direct_messages.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        let convoHeaders = JSON.parse(JSON.stringify(createHeaders(req)));
        convoHeaders["atproto-proxy"] = "did:web:api.bsky.chat#bsky_chat"
        let userData = {}
        let tempMessages = []
        let finalMessages = []
        let users = []
        let selfDid = ""
        let convoPullsInitiated = 0;
        let convoPullsDone = 0;
        let onlyByMe = false;
        if(req.query.only_by_me) {
            onlyByMe = true;
        }
    
        // wrap users into API format
        function messagesPullDone() {
            tempMessages.forEach(tm => {
                tm = JSON.parse(JSON.stringify(tm))
                tm.recipient = userData[tm.recipientDid]
                tm.recipient_id = userData[tm.recipientDid].id;
                tm.sender = userData[tm.senderDid]
                tm.sender_id = userData[tm.senderDid].id;
                if((onlyByMe && tm.senderDid == selfDid)
                || (!onlyByMe && tm.senderDid !== selfDid)) {
                    finalMessages.push(tm)
                }
                
            })
            res.send(finalMessages);
        }
    
        // get all users involved in conversations
        function pullAllUsers(callback) {
            let userPullsNeeded = users.length;
            let userPullsDone = 0;
            users.forEach(u => {
                if(!userData[u]) {
                    pullUserByDid(req, u, (data) => {
                        userData[u] = data;
                        userPullsDone++
                        if(userPullsDone >= userPullsNeeded) {callback()}
                    })
                } else {
                    userPullsDone++
                    if(userPullsDone >= userPullsNeeded) {callback()}
                }
            })
        }
    
        // pull messages from conversation by conversation id
        function pullConvo(convoId) {
            handleToken(req, () => {
                let path = [
                    tokens.site,
                    "/xrpc/chat.bsky.convo.getMessages",
                    "?convoId=" + convoId + "&limit=10"
                ].join("")
                fetch(path, {
                    "headers": convoHeaders,
                    "method": "GET"
                }).then(r => {
                    convoPullsDone++
                    if(r.status !== 200) {
                        res.sendStatus(r.status)
                        return;
                    }
                    let otherParty = ""
                    r.json().then(r => {
                        //let tm = r.messages.filter(s => {s.sender.did !== selfDid})
                        r.messages.forEach(f => {
                            if(f.sender.did !== selfDid) {
                                otherParty = f.sender.did;
                            }
                        })
                        r.messages.forEach(m => {
                            let messageObject = {
                                "text": m.text,
                                "created_at": utils.twitterDate(m.sentAt),
                                "id": new Date(m.sentAt).getTime()
                            }
                            if(m.sender.did == otherParty) {
                                messageObject.senderDid = m.sender.did;
                                messageObject.recipientDid = selfDid;
                            } else {
                                messageObject.senderDid = selfDid;
                                messageObject.recipientDid = otherParty;
                            }
                            tempMessages.push(messageObject)
                        })
    
                        if(convoPullsDone >= convoPullsInitiated) {
                            tempMessages = tempMessages.sort((a, b) => b.time - a.time);
                            tempMessages.forEach(m => {
                                if(!users.includes(m.senderDid)) {
                                    users.push(m.senderDid)
                                }
                            })
                            pullAllUsers(() => {messagesPullDone()})
                        }
                    })
                })
            })
        }
    
        // pull conversations
        handleToken(req, () => {
            let path = [
                tokens.site,
                "/xrpc/chat.bsky.convo.listConvos?limit=5"
            ].join("")
            fetch(path, {
                "headers": convoHeaders,
                "method": "GET"
            }).then(r => {
                if(r.status !== 200) {
                    res.sendStatus(r.status)
                    return;
                }
                r.json().then(r => {
                    r.convos.forEach(c => {
                        let firstTwo = c.members[0].handle + "/" + c.members[1].handle;
                        convoLookupTable.push({"users": firstTwo, "id": c.id})
                        convoPullsInitiated++
                        pullConvo(c.id)
                    })
                })
            })
    
    
            // pull own data by did
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                users.push(r.did);
                selfDid = r.did;
                pullUserByDid(req, r.did, (data) => {
                    userData[r.did] = data;
                })
            })})
        })
    })

    app.post("/1/direct_messages/new.json", (req, res) => {
        let tokens = userTokens[req.headers["x-client-uuid"]]
        if(!req.query.screen_name || !req.query.text) {
            res.sendStatus(400)
            return;
        }
        let self = ""
        let other = ""
        let users = []
        let convoHeaders = JSON.parse(JSON.stringify(createHeaders(req)));
        convoHeaders["atproto-proxy"] = "did:web:api.bsky.chat#bsky_chat"
    
        function sendMessage(convo) {
            req.query.text = decodeURIComponent(req.query.text)
            let path = tokens.site + "/xrpc/chat.bsky.convo.sendMessage"
            fetch(path, {
                "headers": convoHeaders,
                "method": "POST",
                "body": JSON.stringify({
                    "convoId": convo,
                    "message": {
                        "text": req.query.text
                    }
                })
            }).then(r => {
                console.log("send", r.status)
                if(r.status !== 200) {
                    res.sendStatus(r.status)
                    return;
                }
                let messageObject = {
                    "text": req.query.text,
                    "created_at": utils.twitterDate(Date.now()),
                    "id": new Date().getTime()
                }
                let pullsDone = 0
                pullUserByDid(req, self, (data) => {
                    messageObject.sender_id = data.id;
                    messageObject.sender = data;
                    pullsDone++
                    if(pullsDone >= 2) {
                        res.send(messageObject)
                    }
                })
                pullUserByDid(req, other, (data) => {
                    messageObject.recipient_id = data.id;
                    messageObject.recipient = data;
                    pullsDone++
                    if(pullsDone >= 2) {
                        res.send(messageObject)
                    }
                })
            })
        }
    
        function findConvo() {
            let userC1 = users.join("/")
            let userC2 = users.reverse().join("/")
            let convo = convoLookupTable.filter(s => {
                s.users == userC1 || s.users == userC2
            })
            if(convo[0]) {
                sendMessage(convo.id)
            } else {
                let path = [
                    tokens.site,
                    "/xrpc/chat.bsky.convo.getConvoForMembers",
                    "?members=" + other
                ].join("")
                fetch(path, {
                    "headers": convoHeaders,
                    "method": "GET"
                }).then(r => {
                    console.log("get convo", r.status)
                    if(r.status !== 200) {
                        res.sendStatus(r.status)
                        return;
                    }
                    r.json().then(r => {
                        sendMessage(r.convo.id)
                    })
                })
            }
        } 
    
        // recipient
        utils.getIdFromHandle(req.query.screen_name, (did) => {
            other = did;
            users.push(did)
            if(users.length == 2) findConvo()
        })
    
        // sender
        handleToken(req, () => {
            fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
                "headers": createHeaders(req),
                "method": "GET"
            }).then(r => {r.json().then(r => {
                users.push(r.did)
                self = r.did;
                if(users.length == 2) findConvo()
            })})
        })
        return;
    })
}}

const i = new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16])
const crypto = require("crypto")
function decryptWthIk(input) {
    let d = crypto.createDecipheriv("aes-128-cbc", getIk(), i)
    let c = d.update(input, "hex", "utf8").toString()
    c += d.final("utf8")
    return c;
}

function encryptWithIk(input) {
    let d = crypto.createCipheriv("aes-128-cbc", getIk(), i)
    let c = d.update(input, "utf8", "hex")
    c += d.final("hex")
    return c;
}

// calculate ik
let ik = false;
function getIk() {
    if(!ik) {
        ik = fs.statSync("./bsky-twitter.js").birthtime
               .getTime().toString().padStart(16, "0");
    }
    return ik;
}


// api utils
function getFirstStatus(req, did, callback) {
    let tokens = userTokens[req.headers["x-client-uuid"]]
    let path = [
        tokens.site,
        "/xrpc/app.bsky.feed.getAuthorFeed",
        "?actor=" + did,
        "&limit=1"
    ].join("")
    fetch(path, {
        "headers": createHeaders(req),
        "method": "GET"
    }).then(r => {r.json().then(r => {
        let s = false;
        try {
            s = utils.parsePost(r.feed[0].post)
        }
        catch(error) {}
        callback(s)
    })})
}

function getCurrentUser(req, callback) {
    //let tokens = userTokens[req.headers["x-client-uuid"]]
    handleToken(req, () => {
        fetch("https://bsky.social/xrpc/com.atproto.server.getSession", {
            "headers": createHeaders(req),
            "method": "GET"
        }).then(r => {r.json().then(r => {
            callback(r)
        })})
    })
}

function pullUserByDid(req, did, callback) {
    let tokens = userTokens[req.headers["x-client-uuid"]]
    let path = [
        tokens.site,
        "/xrpc/app.bsky.actor.getProfile",
        "?actor=" + did,
        "&limit=20",
    ].join("")
    fetch(path, {
        "headers": createHeaders(req),
        "method": "GET"
    }).then(r => {
        if(r.status !== 200) {
            res.sendStatus(r.status)
            return;
        }
        r.json().then(r => {
            let id = new Date(r.createdAt).getTime()
            cache.write("userLookupTable", id, r.handle)
            callback({
                "id": id,
                "handle": id.toString(),
                "name": r.displayName || r.handle,
                "screen_name": r.handle,
                "description": r.description || "",
                "url": "https://bsky.app/profile/" + r.handle,
                "followers_count": r.followersCount,
                "friends_count": r.followersCount,
                "created_at": utils.twitterDate(r.createdAt),
                "favourites_count": 0,
                "statuses_count": r.postsCount,
                "profile_image_url": [
                    absPath,
                    "/av_proxy?r=",
                    encodeURIComponent(
                        r.avatar.replace("/avatar/", "/avatar_thumbnail/")
                    )
                ].join("")
            })
        })
    })
}