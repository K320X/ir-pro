"""Errors with stable WebSocket codes and user facing messages."""


class IRProError(Exception):
    """An expected IR Pro operation failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
