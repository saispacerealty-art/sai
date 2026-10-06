export interface Position {
  lat: number
  lng: number
  accuracy: number
}

/** One GPS fix. Rejects with a message the user can act on. */
export function getPosition(timeoutMs = 15000): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device does not support location.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Location access is blocked. Allow location for this site in your browser settings and try again.'
              : e.code === e.TIMEOUT
                ? 'Could not get your location in time. Move to an open area and try again.'
                : 'Your location is unavailable right now. Check that GPS is on.',
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}
