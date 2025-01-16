butterflybridge




bsky -> twitter 2.0 android bridge.

aside from v1 apis needed for the specified app to function,
this bridge also proxies twitpic's upload.xml endpoint to embed pictures
within bsky posts, as the twitter app relied on third-party services
for images inside of tweets.

similarily to yt2009, you will need to set up the bridge as a server,
and patch up an early twitter apk to use your API urls instead of (long dead)
twitters'.

setting up:
- npm install
- node bbridgesetup.js
- node bsky-twitter.js

bsky login:

once in a client, use your username and password combo as usual.
you can also use an app password.

if using email 2fa, first, login as usual. you should see a login error.
once you get your code, login again, but this time, adding:
"+2FA-[CODE]"

if your bridge has authorization tokens set up, add:
"+BRIDGE-[AUTH CODE]".
the two above can be chained.