import { useRoute } from '~/app/route'
import { ProfileView } from '~/features/account/ProfileView'
import { OverlayView } from '~/features/overlay/OverlayView'
import { Studio } from '~/Studio'

export function App() {
  const route = useRoute()

  switch (route.name) {
    case 'overlay':
      return <OverlayView token={route.token} />

    // The Browser Source that follows the board live. Authenticated by a key
    // rather than a session, because a Browser Source is a URL in a text field.
    case 'overlayLive':
      return <OverlayView token={route.token} source="live" />

    case 'profile':
      return route.token ? <ProfileView login={route.token} /> : <Studio shareToken={null} />

    // A published board opens in the studio like any other board: whoever
    // follows the link gets the whole app and can drag it about, without
    // changing the copy it came from.
    case 'published':
      return <Studio shareToken={null} publishedSlug={route.token} />

    case 'account':
      return <Studio shareToken={null} openAccount />

    case 'studio':
      return <Studio shareToken={route.token} />
  }
}
