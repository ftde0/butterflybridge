const fetch = require("node-fetch")
const utils = require("./utils")
const cache = require("./caching")
const fs = require("fs")
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"

module.exports = {"register": function(app) {
    app.get("/av_proxy", (req, res) => {
        if(!req.query.r
        || !decodeURIComponent(req.query.r).includes("cdn.bsky.app")) {
            res.sendStatus(400)
            return;
        }
        fetch(decodeURIComponent(req.query.r), {
            "headers": {
                "User-Agent": ua,
                "Accept": "*/*",
                "Accept-Language": "pl,en-US;q=0.7,en;q=0.3",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "cross-site",
                "Priority": "u=4"
            }
        }).then(r => {r.buffer().then(rr => {
            res.set("content-type", "image/jpg")
            res.send(rr)
        })})
    })

    app.get("/view_imgs", (req, res) => {
        if(!req.query.p || !cache.getTable("postImages")[req.query.p]) {
            res.sendStatus(400)
            return;
        }
        let count = cache.getTable("postImages")[req.query.p].length
        let html = `<html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
        .site-container{position:absolute;top:0px;left:0px;width:100%;height:100%;text-align:center;}
        .img-container{position:absolute;top:40px;left:0px;width:100%;height:100%;text-align:center;}
        button{margin-right: 20px;}
        .img{width:100%;height:100%;background: white;}
        img{width:100%;height:auto;}
        </style></head><body>
        <div class="site-container"><button id="left">&lt;</button><button id="right">&gt;</button><span>${count} image(s)</span></div>
        <div class="img-container">`
        let fimg = true;
        cache.getTable("postImages")[req.query.p].forEach(i => {
            html += `<div class="img"${fimg ? ` style="display: block;"` : ` style="display: none;"`}><img src="/av_proxy?r=${encodeURIComponent(i)}"/></div>`
            fimg = false;
        })
        html += `</div></div></body><script>
        function adjust() {
            document.querySelector(".img-container").style.height = (window.innerHeight - 40) + "px"
        }
        adjust();
        window.onresize = adjust;
        var visibleImg = 0;
        var imgCount = ${count};
        document.getElementById("right").onclick = function() {
            visibleImg++;
            if(visibleImg >= imgCount) {
                visibleImg = 0;
            }
            var s = document.querySelectorAll(".img");
            for(var e in s) {
                e = s[e]
                if(e.tagName) {
                    try {
                        e.style.display = "none";
                    }
                    catch(error){}
                }
            }
            s[visibleImg].style.display = "block";
        }
        document.getElementById("left").onclick = function() {
            visibleImg--;
            if(visibleImg < 0) {
                visibleImg = imgCount - 1;
            }
            var s = document.querySelectorAll(".img");
            for(var e in s) {
                e = s[e]
                if(e.tagName) {
                    try {
                        e.style.display = "none";
                    }
                    catch(error){}
                }
            }
            s[visibleImg].style.display = "block";
        }
        </script></head>`
        res.send(html)
    })

    app.get("/process_video", (req, res) => {
        if(!req.query.v || !req.query.v.includes("video.bsky.app")) {
            res.sendStatus(400);
            return;
        }
        let rOptions = {
            "headers": {
                "user-agent": ua,
                "origin": "https://bsky.app",
                "referer": "https://bsky.app/"
            }
        }
        fetch(req.query.v, rOptions).then(r => {r.text().then(r => {

            // get qualities and pick best
            let streams = []
            r.split(`#EXT-X-STREAM-INF:`).forEach(s => {
                if(s.includes(`PROGRAM-ID=0,`)) {
                    let streamUrl = s.split("\n")[1]
                    streams.push(streamUrl)
                }
            })

            // pull best stream url
            let playlistUrl = req.query.v.split("/playlist.m3u8")[0] + "/"
            playlistUrl += streams[streams.length - 1]
            fetch(playlistUrl, rOptions).then(r => {r.text().then(r => {
                
                // pull ts files
                let urls = []
                r.split("#EXTINF:").forEach(s => {
                    if(s.includes(".ts")) {
                        urls.push(
                            playlistUrl.split("/video.m3u8")[0] + "/" + s.split("\n")[1]
                        )
                    }
                })

                utils.pullIntoSingleTs(urls, (fname) => {
                    let cmd = [
                        "ffmpeg",
                        "-i \"" + __dirname + "/" + fname + "\"",
                        "-c:v copy -c:a copy",
                        "\"" + __dirname + "/" + fname + ".mp4\""
                    ].join(" ")
                    require("child_process").exec(cmd, (error, stdout, stderr) => {
                        fs.readdir(__dirname, (error, files) => {
                            files.forEach(f => {
                                if(f.endsWith(".ts")) {
                                    fs.unlink(f, () => {})
                                }
                            })
                        })
                        res.redirect("/" + fname + ".mp4")
                        setTimeout(() => {
                            try {
                                fs.unlinkSync(fname + ".mp4")
                                fs.unlinkSync(fname)
                            }
                            catch(error) {}
                        }, 600000)
                    })
                })

            })})
        })})
    })
}}