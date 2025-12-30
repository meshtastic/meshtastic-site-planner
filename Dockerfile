FROM python:3.11-slim

ENV HOME="/root"

WORKDIR /app
COPY . .

# rust and cargo for maturin
RUN apt-get update && \
    apt-get install -y curl build-essential && \
    curl https://sh.rustup.rs -sSf | sh -s -- -y && \
    echo '. "$HOME/.cargo/env"' >> ~/.bashrc && \
    . "$HOME/.cargo/env" && \
    apt-get clean

# to make cargo happy
ENV PATH="$HOME/.cargo/bin:$PATH"

# finally get maturin installed
RUN pip install --upgrade pip
RUN pip install maturin

# build geoprop-py using maturin
WORKDIR /app/geoprop
RUN maturin build
RUN pip install target/wheels/geoprop-*-manylinux*.whl

# install the other python dependencies
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]

