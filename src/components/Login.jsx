import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase"; // adjust path if needed

const provider = new GoogleAuthProvider();

export default function Login() {

  const loginWithGoogle = async () => {
    try {
      // STEP 6.2
      const result = await signInWithPopup(auth, provider);

      // STEP 6.3
      const token = await result.user.getIdToken();

      // STEP 7
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) throw new Error("Login failed");

      // STEP 9
      localStorage.setItem("loggedIn", "true");

      // STEP 11
      window.location.href = "/dashboard";

    } catch (err) {
      console.error(err);
    }
  };

  return (
    <button onClick={loginWithGoogle}>
      Sign in with Google
    </button>
  );
}
