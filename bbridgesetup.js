const fs = require("fs")
const readline = require("readline-sync")
let cfg = {}

console.log(`


butterflybridge`)


// port
let port;
while(isNaN(parseInt(port))) {
    port = parseInt(
        readline.question("\nwhat port should butterflybridge run on? ")
    )
}
cfg.port = port;

// ip
let ip = ""
console.log(`
what IP should be used?
use an IP your device can reach. things WILL break with this variable
set incorrectly!`)
ip = readline.question("IP address: ")
cfg.ip = ip;

// tokens
let tokens = []
console.log(`
token-lock your bridge?

if so, enter access tokens you would like to allow here.
users of your bridge will need to add the token to their passwords
when logging in, like so:
[password]+BRIDGE-[auth token]

leave empty to disable token requirement.
`)
let tokensString = readline.question("comma-separated tokens: ")
if(tokensString) {
    tokensString.split(",").forEach(t => {if(t.trim().length >= 1) {
        tokens.push(t.trim())
    }})
    cfg.tokens = tokens;
}

// confirmation
console.log(`
writing configuration to config.json.
you can always rerun this setup in the future to make changes.
`)
fs.writeFileSync(`${__dirname}/config.json`, JSON.stringify(cfg))

console.log(`
from now on, use:
node bsky-twitter.js
to start the bridge.
`)
