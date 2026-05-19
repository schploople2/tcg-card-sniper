import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.ts";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const { data } = await api.post<{ token: string }>(endpoint, { email, password });
      localStorage.setItem("token", data.token);
      navigate("/");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Something went wrong";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-navy-900 border border-navy-700 rounded-2xl p-8">
        <div className="text-center mb-8">
          <span className="text-4xl">⚡</span>
          <h1 className="text-xl font-semibold text-white mt-3">TCG Card Sniper</h1>
          <p className="text-slate-400 text-sm mt-1">
            {mode === "login" ? "Sign in to your account" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 uppercase tracking-wide mb-1.5">
              Email
            </label>
            <input
              type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-poke-yellow"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 uppercase tracking-wide mb-1.5">
              Password
            </label>
            <input
              type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-poke-yellow"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-poke-yellow text-navy-950 font-semibold rounded-lg py-2.5 text-sm mt-2 disabled:opacity-60"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          {mode === "login" ? "No account?" : "Already have one?"}{" "}
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-poke-yellow hover:underline"
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
