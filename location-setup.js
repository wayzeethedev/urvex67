// Add this to app.js to register service worker and handle location permissions

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    console.log('Service Worker registered:', registration);
    
    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 60000); // Check every minute
  }).catch((error) => {
    console.warn('Service Worker registration failed:', error);
  });
}

// Request persistent geolocation permission (for PWA)
// Call this when the app loads or when the location button is clicked
function requestLocationPermission() {
  if ('geolocation' in navigator) {
    // Request permission and keep it persistent
    navigator.geolocation.watchPosition(
      (position) => {
        console.log('Location obtained:', position.coords);
      },
      (error) => {
        console.warn('Location permission denied or unavailable:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );
  }
}

// Call this when your locate button is clicked
// document.getElementById('locate-btn').addEventListener('click', requestLocationPermission);