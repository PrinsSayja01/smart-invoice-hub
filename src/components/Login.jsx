import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase"; // path may change

const provider = new GoogleAuthProvider();

export default function Login() {

  cconst loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    const token = await result.user.getIdToken();

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      throw new Error("Login failed");
    }

    // ✅ login success
    console.log("User verified");

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
