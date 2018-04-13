let request = require('request');
var Client                = require('castv2-client').Client;
var DefaultMediaReceiver  = require('castv2-client').DefaultMediaReceiver;
var mdns                  = require('mdns');

let url = 'http://livemasjid.com:8000/status-json.xsl';
let stream_mount = 'hma_furqaan';
let stream = 'http://livemasjid.com:8000/' + stream_mount;
let google_home_address;
let media_player;
let player_state;
let loadMedia;

var sequence = [
    mdns.rst.DNSServiceResolve(),
    'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({families:[4]}),
    mdns.rst.makeAddressesUnique()
];
var browser = mdns.createBrowser(mdns.tcp('googlecast'), {resolverSequence: sequence});

browser.on('serviceUp', function(service) {
    console.log('found device "%s" at %s:%d', service.name, service.addresses[0], service.port);
    google_home_address = service.addresses[0];
    browser.stop();
});

browser.start();

let pollDeviceID = setInterval(() => {
    console.log(google_home_address);
    pollStreams();
    clearInterval(pollDeviceID);
}, 1000);

let MEDIA_PLAYER_NOT_INIT = 0;
let MEDIA_PLAYER_ACTIVE = 1;
let MEDIA_PLAYER_INACTIVE = 0;

let getPlayerStatus = () => {

    return new Promise((resolve, reject) => {

        if (media_player === undefined) {
            resolve(MEDIA_PLAYER_NOT_INIT);
        }

        media_player.getStatus((err, status) => {
            if (err !== null) {
                console.log(status);
                resolve(MEDIA_PLAYER_ACTIVE);
            } else {
                resolve(MEDIA_PLAYER_INACTIVE);
            }
        })
    })
};

let pollStreams = () => {
      let pollStreamID = setInterval(() => {

          console.log(player_state || 'Player not started');
          if (player_state === undefined || player_state === 'IDLE' || player_state === 'BUFFERING') {

              request.get({
                  url: url,
                  json: true,
                  headers: {'User-Agent': 'request'}
              }, (err, res, data) => {
                  if (err) {
                      console.log('Error:', err);
                  } else if (res.statusCode === 200) {
                      // data is already parsed as JSON:
                      data.icestats.source.forEach((source) => {
                          let url  = source.listenurl.substr(source.listenurl.lastIndexOf("/") + 1);
                          if (url === stream_mount) {
                              console.log("Stream Found: " + stream_mount);
                              ondeviceup(google_home_address);
                          }
                      });
                  } else {
                      console.log('Status:', res.statusCode);
                  }
              });

          }


      },10000);
};



function ondeviceup(host) {
    console.log(host,2);
    var client = new Client();

    client.connect(host, function() {
        console.log('connected, launching app ...');

        client.launch(DefaultMediaReceiver, function(err, player) {
            media_player = player;
            var media = {

                // Here you can plug an URL to any mp4, webm, mp3 or jpg file with the proper contentType.
                contentId: stream,
                contentType: 'audio/mpeg',
                streamType: 'LIVE', // or LIVE

                // // Title and cover displayed while buffering
                // metadata: {
                //     type: 0,
                //     metadataType: 0,
                //     title: "Big Buck Bunny",
                //     images: [
                //         { url: 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg' }
                //     ]
                // }
            };

            player.on('status', function(status) {

                if (status !== undefined) {
                    player_state = status.playerState;
                }
                // console.log('status broadcast playerState=%s', status.playerState);
            });

            console.log('app "%s" launched, loading media %s ...', player.session.displayName, media.contentId);

            player.load(media, { autoplay: true }, function(err, status) {
                // console.log('media loaded playerState=%s', status.playerState);

                //Seek to 2 minutes after 15 seconds playing.
                // setTimeout(function() {
                //     player.stop();
                //     // player.seek(2*60, function(err, status) {
                //     //     //
                //     // });
                // }, 15000);

            });

        });

    });

    client.on('error', function(err) {
        console.log('Error: %s', err.message);
        client.close();
    });

}
