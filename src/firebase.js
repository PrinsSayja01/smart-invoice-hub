
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDFTInK3g1RHfRNgbbHCT93OGOd_piSCkY",
  authDomain: "invoiceai-f96e5.firebaseapp.com",
  projectId: "invoiceai-f96e5",
  storageBucket: "invoiceai-f96e5.firebasestorage.app",
  messagingSenderId: "9494668535",
  appId: "1:9494668535:web:ab553dc701dc377d075ff2",
  measurementId: "G-9LJD26QE8G"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

