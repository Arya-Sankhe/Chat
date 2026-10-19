import { Navigate, Route, Routes } from "react-router";
import { useAuth } from "./app/auth";
import { Shell } from "./components/Shell";
import { SignIn } from "./components/SignIn";
import { ChatRoute } from "./routes/ChatRoute";

export function App() {
  const status = useAuth((state) => state.status);
  const error = useAuth((state) => state.error);

  if (status === "booting") return <div className="splash" aria-busy="true" />;
  if (status === "error") return <div className="splash"><p className="splash-error">{error}</p></div>;
  if (status === "signedOut") return <SignIn />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<ChatRoute />} />
        <Route path="c/:conversationId" element={<ChatRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
