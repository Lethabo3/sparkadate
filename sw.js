const CACHE_NAME = 'spark-v1';
const urlsToCache = [
    '/Spark/',
    '/Spark/index.html',
    '/Spark/onboarding.html',
    '/Spark/onboarding1.html',
    '/Spark/signup.html',
    '/Spark/login.html',
    '/Spark/plan.html',
    '/Spark/payment.html',
    '/Spark/match.html',
    '/Spark/chat.html',
    '/Spark/timer.html',
    '/Spark/reveal.html',
    '/Spark/revealed.html',
    '/Spark/exit.html',
    '/Spark/blueocean.jpeg',
    '/Spark/fonts/CabinetGrotesk-Medium.woff2',
    '/Spark/fonts/CabinetGrotesk-Medium.woff',
    '/Spark/fonts/CabinetGrotesk-Medium.ttf'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});
