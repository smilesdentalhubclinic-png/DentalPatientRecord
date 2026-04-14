function ErrorModal({ message, onClose, title = 'Notice' }) {
  if (!message) return null

  return (
    <div className="error-modal-layer">
      <div className="error-modal-backdrop" onClick={onClose} />
      <div className="pr-modal procedures-modal procedures-error-modal" role="dialog" aria-modal="true" aria-labelledby="global-error-title">
        <div className="pr-modal-head"><h2 id="global-error-title">{title}</h2></div>
        <div className="pr-modal-body">
          <p>{message}</p>
          <div className="modal-actions">
            <button type="button" className="success-btn" onClick={onClose}>OK</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ErrorModal
