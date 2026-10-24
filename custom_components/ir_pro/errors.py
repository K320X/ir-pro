"""Errors with stable WebSocket codes and user facing messages."""

from .localization import localize_message, translation_key


class IRProError(Exception):
    """An expected IR Pro operation failure."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def translation_key(self) -> str:
        """The native HA exception key, independent of the operation code."""
        return translation_key(self.message)

    def localized_message(self, language: str) -> str:
        """Return presentation text without changing the original diagnostic."""
        return localize_message(self.message, language)
