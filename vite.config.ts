import { defineConfig } from "vite"; // Vite configuration function
import react from "@vitejs/plugin-react-swc"; // React plugin for SWC-based builds
import path from "path"; // Node's path module
import { componentTagger } from "lovable-tagger"; // Plugin for tagging components

// Vite config export
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",  // Listen on all IPv6 addresses
    port: 8080,  // Set the development server port to 8080
  },
  plugins: [
    react(),  // React plugin for Vite
    mode === "development" && componentTagger(),  // Only add componentTagger in development mode
  ].filter(Boolean),  // Remove any falsy values (like undefined)
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),  // Alias '@' to the 'src' directory
    },
  },
}));
