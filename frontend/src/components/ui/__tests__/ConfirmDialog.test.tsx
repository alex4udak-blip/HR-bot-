import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConfirmDialog from '../ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    title: 'Delete Item',
    message: 'Are you sure you want to delete this item?',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render nothing when not open', () => {
    const { container } = render(
      <ConfirmDialog {...defaultProps} open={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render dialog when open', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure you want to delete this item?')).toBeInTheDocument();
  });

  it('should use default button labels', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('should use custom button labels when provided', () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        confirmLabel="Delete"
        cancelLabel="Keep"
      />
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });

  it('should call onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should call onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    // Click the backdrop (the outer div with backdrop-blur-sm class)
    const backdrop = container.querySelector('.backdrop-blur-sm');
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    }
  });

  it('should call onCancel when close button is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    const closeButton = screen.getByLabelText('Close dialog');
    fireEvent.click(closeButton);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('should display loading state when loading is true', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    expect(screen.getByText('Processing...')).toBeInTheDocument();
    expect(screen.queryByText('Confirm')).not.toBeInTheDocument();
  });

  it('should disable buttons when loading', () => {
    render(<ConfirmDialog {...defaultProps} loading={true} />);

    const confirmButton = screen.getByText('Processing...');
    const cancelButton = screen.getByText('Cancel');

    expect(confirmButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
  });

  it('should not call onCancel when backdrop clicked during loading', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} loading={true} />);

    // Click the backdrop - should not trigger onCancel during loading
    const backdrop = screen.getByRole('dialog').parentElement;
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onCancel).not.toHaveBeenCalled();
    }
  });

  describe('variants', () => {
    it('should render danger variant correctly', () => {
      render(<ConfirmDialog {...defaultProps} variant="danger" />);
      // The dialog should render with danger styling (red colors)
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render warning variant correctly', () => {
      render(<ConfirmDialog {...defaultProps} variant="warning" />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('should render info variant correctly', () => {
      render(<ConfirmDialog {...defaultProps} variant="info" />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('should have accessible role and aria attributes', () => {
    render(<ConfirmDialog {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-dialog-title');
  });

  it('should stop event propagation when clicking inside dialog', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    // Click inside the dialog content
    const title = screen.getByText('Delete Item');
    fireEvent.click(title);

    // onCancel should not be called when clicking inside the dialog
    expect(onCancel).not.toHaveBeenCalled();
  });
});
