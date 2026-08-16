import os
import sys

# launcher.py lives one directory up and isn't a package -- put it on the
# path so `import launcher` works regardless of where pytest is invoked
# from.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
