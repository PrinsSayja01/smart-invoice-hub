import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../firebase"; // path may change

const provider = new GoogleAuthProvider();

export default function Login() {

  const loginWithGoogle = async () => {
    try {
      // STEP 6.2 – open Google popup
      const result = await signInWithPopup(auth, provider);

      // STEP 6.3 – get ID token
      const token = await result.user.getIdToken();

      // STEP 7 – send token to backend
      await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      console.log("Login success");

    } catch (err) {
      console.error("Login failed", err);
    }
  };

  return (
    <button onClick={loginWithGoogle}>
      Sign in with Google
    </button>
  );
}
