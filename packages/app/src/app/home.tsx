import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { HomeScreen } from "@/home-map/home-screen"; // Nazmul mod (home-map)

export default function HomeRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HomeScreen />
    </HostRouteBootstrapBoundary>
  );
}
