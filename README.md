# PythonVx 🚀

**Visualize your Python code in real-time.** 

PythonVx is a high-fidelity, interactive code visualizer designed to help developers and students see the logic behind their code. By bridging the gap between raw execution and visual understanding, PythonVx transforms line-by-line tracing into a smooth, animated experience.

---

## 📥 Downloads

Ready to use PythonVx locally without setting up the development environment? Download the latest stable version for your system:

| Platform | Download Link |
| :--- | :--- |
| **🪟 Windows** | [Download .msi / .exe](https://github.com/K-692/PythonVx/releases/latest) |
| **🍎 macOS** | [Download .dmg](https://github.com/K-692/PythonVx/releases/latest) |

> [!TIP]
> After downloading, you may need to grant permission in your system settings (e.g., Gatekeeper on macOS) before running the app.

---

## ✨ Features

- **Live Tracing**: Watch your code execute step-by-step with synchronized variable state.
- **Flight Animations**: Values "fly" from the RHS to LHS during assignments, making logic intuitive.
- **Interactive Timeline**: Scrub through your code's history with advanced playback controls.
- **Modern UI**: A sleek, dark-themed interface built with React, Vite, and Framer Motion.
- **Modular Architecture**: A clean separation between the Python tracer logic and the web-based visualizer.

---

## 🛠 How It Works

PythonVx uses a **two-layered approach**:

1.  **The Tracer (Python)**: Uses a custom execution engine (`tracer.py`) to record every line of execution, variable change, and function call into a structured timeline.
2.  **The Visualizer (React/TypeScript)**: Receives the timeline and renders it as an interactive, scaffolded view where data flows naturally across the screen.

---

## 🚀 Getting Started

To run PythonVx locally, you'll need both Python (for the tracer) and Node.js (for the frontend).

### 1. Prerequisites
- Python 3.8+
- Node.js 18+ & npm

### 2. Setup
```bash
# Clone the repository
git clone https://github.com/K-692/PythonVx.git
cd PythonVx

# Set up Python environment
python -m venv venv
source venv/bin/activate  # On Windows use: venv\Scripts\activate
pip install -r requirements.txt

# Set up Frontend
cd python-visualizer
npm install
npm run dev
```

---

## ❤️ Contributing

We believe the best tools are built together. Whether you're fixing a bug, suggesting a feature, or just pointing out a typo, we'd love your help!

**Join us:**
- Fork the repo and submit a PR.
- Open an issue for any "Aha!" moments or "Oh no!" bugs.
- Spread the word if PythonVx helped you learn!

---

## 📜 License

This project is licensed under the **MIT License** — feel free to use it, share it, and build on top of it. See the [LICENSE](LICENSE) file for details.

---

*Built with ❤️ for the Python community.*
