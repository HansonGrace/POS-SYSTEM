import { Navigate, Route, Routes } from "react-router-dom";
import LoginUser from "./routes/LoginUser";
import LoginAdmin from "./routes/LoginAdmin";
import AdminHome from "./routes/AdminHome";
import ProtectedRoute from "./components/ProtectedRoute";
import UserInterface from "./routes/UserInterface";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginUser />} />
      <Route path="/admin/login" element={<LoginAdmin />} />

      <Route
        path="/userinterface"
        element={
          <ProtectedRoute requiredRole="user" redirectTo="/login">
            <UserInterface />
          </ProtectedRoute>
        }
      />

      <Route path="/pos" element={<Navigate to="/userinterface" replace />} />

      <Route
        path="/admin"
        element={
          <ProtectedRoute requiredRole="admin" redirectTo="/admin/login">
            <AdminHome />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
