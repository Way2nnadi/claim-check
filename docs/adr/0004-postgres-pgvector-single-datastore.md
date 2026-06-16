# Postgres + pgvector as the single datastore; no dedicated vector DB

The MVP uses a single Postgres instance (with the pgvector extension) for structured Rules, versions, candidate/approval state, and section embeddings used by the QA pass. Raw Policy Documents are kept in S3-compatible object storage (MinIO for private installs). We deliberately do not run a separate vector database (Qdrant/Weaviate/Milvus), despite the spec listing them as options.

Target customers deploy on their own private/offline infrastructure, where every additional stateful service is an operational and security burden. pgvector's retrieval is more than adequate at policy-document scale (thousands of sections, not billions of vectors). The trade-off is a lower retrieval ceiling that we accept now; if a customer's corpus ever outgrows pgvector, the retrieval interface is abstracted so a dedicated vector DB can be swapped in without touching extraction or QA logic.
