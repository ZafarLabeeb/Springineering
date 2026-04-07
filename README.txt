Moon satellite simulator - browser version

What changed:
- The old Ursina visualizer was replaced by a browser frontend.
- Python still runs the orbital and communications logic.
- The browser gets live simulation data from Flask API endpoints.

How to run:
1. Open a terminal in this folder.
2. Install dependencies:
   pip install -r requirements.txt
3. Start the app:
   python main_sim.py
4. Open your browser at:
   http://127.0.0.1:5000/

Optional:
- You can also run:
  python visualizer.py
- You can still use the console version:
  python main_sim.py --cli --num-sats 50 --dt 100 --steps 10
