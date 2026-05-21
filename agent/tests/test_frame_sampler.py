import pytest

from agent.video.sampler import FrameSampler, SampledFrame


def test_sampled_frame_holds_image_and_timestamp() -> None:
    frame = SampledFrame(image_bytes=b"\x00jpeg", timestamp_seconds=4.0)
    assert frame.image_bytes == b"\x00jpeg"
    assert frame.timestamp_seconds == 4.0


def test_sampler_keeps_one_frame_per_interval() -> None:
    # At 1 fps, frames arriving every 0.1s yield one kept frame per second.
    sampler = FrameSampler(target_fps=1.0)
    kept = []
    for i in range(25):  # 2.5 seconds of 10 fps input
        decision = sampler.offer(
            image_bytes=f"f{i}".encode(), timestamp_seconds=i * 0.1
        )
        if decision is not None:
            kept.append(decision)
    # 2.5s at 1 fps -> 3 frames kept (t=0.0, ~1.0, ~2.0).
    assert len(kept) == 3
    assert kept[0].timestamp_seconds == 0.0


def test_sampler_two_fps_keeps_twice_as_many() -> None:
    sampler = FrameSampler(target_fps=2.0)
    kept = []
    for i in range(20):  # 2.0 seconds of 10 fps input
        decision = sampler.offer(image_bytes=b"f", timestamp_seconds=i * 0.1)
        if decision is not None:
            kept.append(decision)
    # 2.0s at 2 fps -> 4 frames kept.
    assert len(kept) == 4


def test_sampler_rejects_non_positive_fps() -> None:
    with pytest.raises(ValueError, match="fps"):
        FrameSampler(target_fps=0.0)
