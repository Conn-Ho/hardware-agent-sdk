FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    openscad \
    python3 python3-pip \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir trimesh matplotlib numpy

WORKDIR /workspace
COPY entrypoint.py /entrypoint.py

EXPOSE 8765
CMD ["python3", "/entrypoint.py"]
