import { useRoute } from '~/app/route'
import { OverlayView } from '~/features/overlay/OverlayView'
import { Studio } from '~/Studio'

export function App() {
  const route = useRoute()

  if (route.name === 'overlay') return <OverlayView token={route.token} />
  return <Studio shareToken={route.token} />
}
