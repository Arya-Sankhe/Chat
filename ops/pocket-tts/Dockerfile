FROM python:3.12-slim

# CPU-only torch: the default PyPI wheel drags in ~3 GB of CUDA libraries.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    pocket-tts==3.3.0 torch==2.14.1+cpu fastapi==0.142.4 uvicorn==0.54.0 lameenc==1.8.4 audiotsm==0.1.2

WORKDIR /app
COPY server.py ./

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
