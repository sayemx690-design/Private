const CACHE_NAME = "chatflow-v1";
const urlsToCache = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./config.js",
  "https://cdn.tailwindcss.com",
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js"
];

// Install
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
    .then(cache => cache.addAll(urlsToCache))
  );
});

// Activate
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
});

// Fetch
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
    .then(response => {
      return response || fetch(event.request);
    })
  );
});