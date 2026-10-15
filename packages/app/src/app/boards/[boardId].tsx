import { useLocalSearchParams } from "expo-router";
import { BoardScreen } from "@/boards/board-screen";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";

export default function BoardRoute() {
  const params = useLocalSearchParams<{ boardId?: string | string[] }>();
  const raw = Array.isArray(params.boardId) ? params.boardId[0] : params.boardId;
  const boardId = typeof raw === "string" ? raw.trim() : "";

  return (
    <HostRouteBootstrapBoundary>
      <BoardScreen boardId={boardId} />
    </HostRouteBootstrapBoundary>
  );
}
